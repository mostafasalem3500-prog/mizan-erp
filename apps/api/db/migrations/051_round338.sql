-- 3.38.0: modifiers (priced add-ons) and service charge, supplier payment runs, auditor findings dismissed by the user

-- priced add-ons for a product (size, extras, removal): a group of options with a minimum/maximum choice,
-- attached to products and/or whole categories
CREATE TABLE IF NOT EXISTS modifier_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  min_select   int  NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select   int  NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  options      jsonb NOT NULL DEFAULT '[]', -- [{id, name, price, active}]
  product_ids  uuid[] NOT NULL DEFAULT '{}',
  category_ids uuid[] NOT NULL DEFAULT '{}',
  is_active    boolean NOT NULL DEFAULT true,
  sort         int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (max_select >= min_select)
);
CREATE INDEX IF NOT EXISTS modifier_groups_company ON modifier_groups(company_id) WHERE is_active;
-- what was chosen on a sold line (names and prices as sold), for the receipt, the kitchen and the modifiers report
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS modifiers jsonb;

-- supplier payment run (proposal → approval → one payment voucher per supplier)
CREATE TABLE IF NOT EXISTS payment_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  pay_date     date NOT NULL,
  due_until    date NOT NULL,
  account_id   uuid NOT NULL REFERENCES accounts(id),
  method       text NOT NULL DEFAULT 'BANK',
  status       text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','POSTED','CANCELLED')),
  total        numeric(18,2) NOT NULL DEFAULT 0,
  notes        text,
  created_by   text,
  created_by_id uuid,
  approved_by  text,
  approved_at  timestamptz,
  posted_at    timestamptz,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE TABLE IF NOT EXISTS payment_run_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES payment_runs(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES partners(id),
  invoice_id  uuid NOT NULL REFERENCES invoices(id),
  amount      numeric(18,2) NOT NULL CHECK (amount > 0),
  payment_id  uuid REFERENCES payments(id) ON DELETE SET NULL,
  UNIQUE (run_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS payment_run_lines_invoice ON payment_run_lines(invoice_id);

-- smart auditor: a finding the user reviewed and marked as explained stays hidden
CREATE TABLE IF NOT EXISTS audit_dismissals (
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL,
  ref         text NOT NULL,
  note        text,
  dismissed_by text,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, kind, ref)
);
