-- ═══════════════════════════════════════════════════════════════════════════
-- Mizan ERP v2 — core schema
-- Multi-tenant: every business table carries company_id.
-- Every money movement is a journal_entries/journal_lines pair written by the
-- posting engine (src/accounting/posting.ts) inside the same DB transaction
-- as the business document.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0) Preserve v1 data: move every v1 table/enum into schema "legacy" (non-destructive).
CREATE SCHEMA IF NOT EXISTS legacy;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations','branches','users','organization_users','roles','permissions',
    'role_permissions','accounts','fiscal_years','accounting_periods','journal_entries','idempotency_keys',
    'journal_entry_lines','customers','suppliers','products','pos_sales','sales_invoices','purchase_bills',
    'expenses','assets','payments','stock_levels','pos_shifts','audit_logs','_prisma_migrations']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA legacy', t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['AccountType','PeriodStatus','JournalSourceEvent']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_type ty JOIN pg_namespace n ON n.oid=ty.typnamespace WHERE n.nspname='public' AND ty.typname=t) THEN
      EXECUTE format('ALTER TYPE public.%I SET SCHEMA legacy', t);
    END IF;
  END LOOP;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── SaaS / tenancy ────────────────────────────────────────────────────────
CREATE TABLE companies (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar             text NOT NULL,
  name_en             text,
  vat_number          text,
  cr_number           text,
  phone               text,
  email               text,
  website             text,
  logo                text,
  street              text,
  building_no         text,
  additional_no       text,
  district            text,
  city                text,
  postal_code         text,
  country             text NOT NULL DEFAULT 'SA',
  currency            text NOT NULL DEFAULT 'SAR',
  fiscal_year_start   int  NOT NULL DEFAULT 1,
  plan                text NOT NULL DEFAULT 'TRIAL',
  status              text NOT NULL DEFAULT 'ACTIVE',
  max_users           int  NOT NULL DEFAULT 3,
  subscription_ends_at timestamptz,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  prices_include_vat  boolean NOT NULL DEFAULT false,
  invoice_footer      text,
  invoice_terms       text,
  invoice_template    jsonb,
  demo_loaded         boolean NOT NULL DEFAULT false,
  demo_job            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  full_name      text NOT NULL,
  phone          text,
  is_super_admin boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL,
  branch_id  uuid,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, user_id)
);

CREATE TABLE license_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL UNIQUE,
  plan         text NOT NULL,
  months       int  NOT NULL,
  max_users    int  NOT NULL,
  note         text,
  company_id   uuid REFERENCES companies(id) ON DELETE SET NULL,
  activated_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  address    text,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE warehouses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE sequences (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key        text NOT NULL,
  next       int  NOT NULL DEFAULT 1,
  PRIMARY KEY (company_id, key)
);

CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid,
  user_name  text,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  text,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_company_idx ON audit_logs(company_id, created_at DESC);

-- ─── Accounting core ───────────────────────────────────────────────────────
CREATE TABLE accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name_ar      text NOT NULL,
  name_en      text,
  type         text NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  subtype      text NOT NULL,
  parent_id    uuid REFERENCES accounts(id),
  level        int  NOT NULL DEFAULT 1,
  is_group     boolean NOT NULL DEFAULT false,
  is_system    boolean NOT NULL DEFAULT false,
  system_key   text,
  is_active    boolean NOT NULL DEFAULT true,
  is_cash_bank boolean NOT NULL DEFAULT false,
  is_demo      boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX accounts_system_key_uq ON accounts(company_id, system_key) WHERE system_key IS NOT NULL;

CREATE TABLE cost_centers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE fiscal_years (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name             text NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN',
  closing_entry_id uuid,
  closed_at        timestamptz,
  UNIQUE (company_id, name)
);

CREATE TABLE periods (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  status         text NOT NULL DEFAULT 'OPEN'
);
CREATE INDEX periods_company_idx ON periods(company_id, start_date);

CREATE TABLE journal_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number      text NOT NULL,
  date        date NOT NULL,
  type        text NOT NULL,
  status      text NOT NULL DEFAULT 'POSTED',
  source_type text,
  source_id   uuid,
  reference   text,
  memo        text,
  branch_id   uuid,
  total_debit numeric(18,2) NOT NULL DEFAULT 0,
  reversal_of uuid,
  reversed_by uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  posted_at   timestamptz,
  UNIQUE (company_id, number)
);
CREATE INDEX je_company_date_idx ON journal_entries(company_id, date);
CREATE INDEX je_source_idx ON journal_entries(company_id, source_type, source_id);

CREATE TABLE journal_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id       uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  debit          numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  partner_id     uuid,
  cost_center_id uuid,
  description    text,
  sort           int NOT NULL DEFAULT 0
);
CREATE INDEX jl_company_account_idx ON journal_lines(company_id, account_id);
CREATE INDEX jl_company_partner_idx ON journal_lines(company_id, partner_id);
CREATE INDEX jl_entry_idx ON journal_lines(entry_id);

-- Database-level guarantee that no posted entry can be unbalanced, whatever code path wrote it.
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric; c numeric; st text; eid uuid;
BEGIN
  eid := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT status INTO st FROM journal_entries WHERE id = eid;
  IF st IS NULL OR st <> 'POSTED' THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0) INTO d, c FROM journal_lines WHERE entry_id = eid;
  IF d <> c THEN
    RAISE EXCEPTION 'UNBALANCED_ENTRY % debit=% credit=%', eid, d, c;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- ─── Master data ───────────────────────────────────────────────────────────
CREATE TABLE partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  name_en       text,
  is_customer   boolean NOT NULL DEFAULT false,
  is_supplier   boolean NOT NULL DEFAULT false,
  kind          text NOT NULL DEFAULT 'COMPANY',
  vat_number    text,
  cr_number     text,
  phone         text,
  email         text,
  street        text,
  building_no   text,
  district      text,
  city          text,
  postal_code   text,
  country       text NOT NULL DEFAULT 'SA',
  credit_limit  numeric(18,2) NOT NULL DEFAULT 0,
  payment_terms int NOT NULL DEFAULT 0,
  notes         text,
  is_active     boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX partners_name_idx ON partners(company_id, name);

CREATE TABLE product_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  color      text,
  is_demo    boolean NOT NULL DEFAULT false
);

CREATE TABLE products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku            text NOT NULL,
  barcode        text,
  name           text NOT NULL,
  name_en        text,
  type           text NOT NULL DEFAULT 'STOCK',
  category_id    uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  unit           text NOT NULL DEFAULT 'حبة',
  sale_price     numeric(18,4) NOT NULL DEFAULT 0,
  purchase_price numeric(18,4) NOT NULL DEFAULT 0,
  tax_code       text NOT NULL DEFAULT 'S',
  reorder_level  numeric(18,3) NOT NULL DEFAULT 0,
  image          text,
  is_active      boolean NOT NULL DEFAULT true,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
CREATE INDEX products_barcode_idx ON products(company_id, barcode);

-- ─── Inventory ─────────────────────────────────────────────────────────────
CREATE TABLE stock_balances (
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty          numeric(18,3) NOT NULL DEFAULT 0,
  value        numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, product_id, warehouse_id)
);

CREATE TABLE stock_moves (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date         date NOT NULL,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  qty          numeric(18,3) NOT NULL,
  unit_cost    numeric(18,4) NOT NULL,
  value        numeric(18,2) NOT NULL,
  balance_qty  numeric(18,3) NOT NULL,
  balance_val  numeric(18,2) NOT NULL,
  source_type  text NOT NULL,
  source_id    uuid,
  reference    text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_product_idx ON stock_moves(company_id, product_id, date, created_at);

CREATE TABLE stock_adjustments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  date         date NOT NULL,
  warehouse_id uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'COUNT',
  to_warehouse uuid,
  notes        text,
  lines        jsonb NOT NULL,
  total_value  numeric(18,2) NOT NULL DEFAULT 0,
  journal_id   uuid,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- ─── Documents ─────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direction       text NOT NULL CHECK (direction IN ('SALE','PURCHASE')),
  kind            text NOT NULL CHECK (kind IN ('QUOTATION','ORDER','INVOICE','CREDIT_NOTE','DEBIT_NOTE')),
  channel         text NOT NULL DEFAULT 'BACKOFFICE',
  number          text NOT NULL,
  date            date NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  due_date        date,
  partner_id      uuid REFERENCES partners(id),
  partner_name    text,
  partner_vat     text,
  branch_id       uuid,
  warehouse_id    uuid,
  invoice_type    text NOT NULL DEFAULT 'STANDARD',
  status          text NOT NULL DEFAULT 'DRAFT',
  payment_status  text NOT NULL DEFAULT 'UNPAID',
  origin_id       uuid,
  supplier_ref    text,
  reason          text,
  notes           text,
  subtotal        numeric(18,2) NOT NULL DEFAULT 0,
  discount_total  numeric(18,2) NOT NULL DEFAULT 0,
  taxable         numeric(18,2) NOT NULL DEFAULT 0,
  vat_total       numeric(18,2) NOT NULL DEFAULT 0,
  total           numeric(18,2) NOT NULL DEFAULT 0,
  cost_total      numeric(18,2) NOT NULL DEFAULT 0,
  amount_paid     numeric(18,2) NOT NULL DEFAULT 0,
  tenders         jsonb,
  pos_session_id  uuid,
  journal_id      uuid,
  uuid            uuid NOT NULL DEFAULT gen_random_uuid(),
  icv             int,
  pih             text,
  invoice_hash    text,
  qr              text,
  xml             text,
  zatca_status    text,
  zatca_response  jsonb,
  is_demo         boolean NOT NULL DEFAULT false,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX invoices_list_idx ON invoices(company_id, direction, kind, date DESC);
CREATE INDEX invoices_partner_idx ON invoices(company_id, partner_id);
CREATE INDEX invoices_origin_idx ON invoices(origin_id);

CREATE TABLE invoice_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id   uuid,
  account_id   uuid,
  description  text NOT NULL,
  qty          numeric(18,3) NOT NULL,
  unit_price   numeric(18,4) NOT NULL,
  discount_pct numeric(7,3) NOT NULL DEFAULT 0,
  tax_code     text NOT NULL DEFAULT 'S',
  tax_rate     numeric(5,2) NOT NULL DEFAULT 15,
  net_amount   numeric(18,2) NOT NULL,
  vat_amount   numeric(18,2) NOT NULL,
  total        numeric(18,2) NOT NULL,
  unit_cost    numeric(18,4) NOT NULL DEFAULT 0,
  sort         int NOT NULL DEFAULT 0
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines(invoice_id);
CREATE INDEX invoice_lines_product_idx ON invoice_lines(product_id);

CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  direction    text NOT NULL CHECK (direction IN ('IN','OUT')),
  partner_role text NOT NULL CHECK (partner_role IN ('CUSTOMER','SUPPLIER')),
  partner_id   uuid NOT NULL REFERENCES partners(id),
  date         date NOT NULL,
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  allocated    numeric(18,2) NOT NULL DEFAULT 0,
  method       text NOT NULL DEFAULT 'CASH',
  account_id   uuid NOT NULL REFERENCES accounts(id),
  reference    text,
  notes        text,
  allocations  jsonb,
  status       text NOT NULL DEFAULT 'POSTED',
  journal_id   uuid,
  is_demo      boolean NOT NULL DEFAULT false,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX payments_partner_idx ON payments(company_id, partner_id);

CREATE TABLE expenses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number         text NOT NULL,
  date           date NOT NULL,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  payee          text,
  partner_id     uuid,
  supplier_vat   text,
  supplier_ref   text,
  description    text NOT NULL,
  amount         numeric(18,2) NOT NULL,
  tax_code       text NOT NULL DEFAULT 'S',
  vat_amount     numeric(18,2) NOT NULL DEFAULT 0,
  total          numeric(18,2) NOT NULL,
  pay_account_id uuid,
  cost_center_id uuid,
  status         text NOT NULL DEFAULT 'POSTED',
  journal_id     uuid,
  is_demo        boolean NOT NULL DEFAULT false,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE pos_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number        text NOT NULL,
  user_id       uuid NOT NULL,
  user_name     text,
  warehouse_id  uuid NOT NULL,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  opening_cash  numeric(18,2) NOT NULL DEFAULT 0,
  cash_sales    numeric(18,2) NOT NULL DEFAULT 0,
  card_sales    numeric(18,2) NOT NULL DEFAULT 0,
  returns_total numeric(18,2) NOT NULL DEFAULT 0,
  expected_cash numeric(18,2),
  counted_cash  numeric(18,2),
  difference    numeric(18,2),
  orders_count  int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'OPEN',
  journal_id    uuid,
  is_demo       boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, number)
);

CREATE TABLE fixed_assets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  category            text,
  acquisition_date    date NOT NULL,
  cost                numeric(18,2) NOT NULL,
  salvage_value       numeric(18,2) NOT NULL DEFAULT 0,
  useful_life_months  int NOT NULL,
  accumulated         numeric(18,2) NOT NULL DEFAULT 0,
  asset_account_id    uuid NOT NULL REFERENCES accounts(id),
  acc_dep_account_id  uuid NOT NULL REFERENCES accounts(id),
  dep_exp_account_id  uuid NOT NULL REFERENCES accounts(id),
  pay_account_id      uuid,
  last_depreciation   date,
  status              text NOT NULL DEFAULT 'ACTIVE',
  journal_id          uuid,
  is_demo             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE asset_depreciations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id    uuid NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_end  date NOT NULL,
  amount      numeric(18,2) NOT NULL,
  journal_id  uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  UNIQUE (asset_id, period_end)
);

CREATE TABLE vat_returns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to   date NOT NULL,
  data        jsonb NOT NULL,
  net_vat     numeric(18,2) NOT NULL,
  status      text NOT NULL DEFAULT 'FILED',
  journal_id  uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── ZATCA e-invoicing ─────────────────────────────────────────────────────
CREATE TABLE zatca_configs (
  company_id         uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  phase              int  NOT NULL DEFAULT 1,
  environment        text NOT NULL DEFAULT 'SANDBOX',
  egs_serial         text,
  egs_uuid           uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_name        text,
  industry           text,
  private_key        text,
  csr                text,
  compliance_cert    text,
  compliance_secret  text,
  compliance_req_id  text,
  production_cert    text,
  production_secret  text,
  onboarded_at       timestamptz,
  icv_counter        int  NOT NULL DEFAULT 0,
  last_hash          text NOT NULL DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==',
  log                jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
