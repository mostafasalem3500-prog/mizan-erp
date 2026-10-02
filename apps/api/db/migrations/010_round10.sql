-- Round 10: multi-branch accounting dimension + Salla store connector

-- ── branches ───────────────────────────────────────────────────────────────
ALTER TABLE branches ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_main boolean NOT NULL DEFAULT false;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id);
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- every company gets exactly one main branch
INSERT INTO branches(company_id, code, name, is_main)
  SELECT c.id, 'MAIN', 'الفرع الرئيسي', true FROM companies c WHERE NOT EXISTS (SELECT 1 FROM branches b WHERE b.company_id = c.id);
UPDATE branches b SET is_main = true
  WHERE b.id IN (SELECT DISTINCT ON (company_id) id FROM branches ORDER BY company_id, (code = 'MAIN') DESC, code)
    AND NOT EXISTS (SELECT 1 FROM branches x WHERE x.company_id = b.company_id AND x.is_main);
CREATE UNIQUE INDEX IF NOT EXISTS branches_one_main ON branches(company_id) WHERE is_main;

-- back-fill: warehouses → main branch; documents → warehouse branch; entries → document branch, else main
UPDATE warehouses w SET branch_id = (SELECT id FROM branches b WHERE b.company_id = w.company_id AND b.is_main) WHERE branch_id IS NULL;
UPDATE invoices i SET branch_id = COALESCE((SELECT branch_id FROM warehouses w WHERE w.id = i.warehouse_id), (SELECT id FROM branches b WHERE b.company_id = i.company_id AND b.is_main)) WHERE branch_id IS NULL;
UPDATE journal_entries e SET branch_id = i.branch_id FROM invoices i WHERE e.branch_id IS NULL AND e.source_type = 'INVOICE' AND e.source_id = i.id;
UPDATE journal_entries e SET branch_id = w.branch_id FROM pos_sessions s JOIN warehouses w ON w.id = s.warehouse_id WHERE e.branch_id IS NULL AND e.source_type = 'POS_SESSION' AND e.source_id = s.id;
UPDATE journal_entries e SET branch_id = w.branch_id FROM stock_adjustments a JOIN warehouses w ON w.id = a.warehouse_id WHERE e.branch_id IS NULL AND e.source_type = 'STOCK_ADJUSTMENT' AND e.source_id = a.id;
UPDATE journal_entries e SET branch_id = (SELECT id FROM branches b WHERE b.company_id = e.company_id AND b.is_main) WHERE branch_id IS NULL;
CREATE INDEX IF NOT EXISTS je_branch_idx ON journal_entries(company_id, branch_id, date);

-- ── Salla connector ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS salla_connections (
  company_id         uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  token              text NOT NULL UNIQUE,          -- path secret in the webhook URL
  secret             text,                          -- Salla webhook secret → verifies X-Salla-Signature (HMAC-SHA256)
  store_name         text,
  enabled            boolean NOT NULL DEFAULT true,
  auto_post          boolean NOT NULL DEFAULT true, -- post invoices immediately (else keep drafts for review)
  post_on_status     text NOT NULL DEFAULT 'created', -- 'created' | 'completed' | 'delivered'
  warehouse_id       uuid REFERENCES warehouses(id),
  branch_id          uuid REFERENCES branches(id),
  deposit_account_id uuid REFERENCES accounts(id),  -- prepaid orders are settled into this clearing/bank account
  create_products    boolean NOT NULL DEFAULT true, -- unknown SKUs become products
  last_event_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salla_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  event         text NOT NULL,
  salla_id      text,
  reference     text,
  status        text NOT NULL DEFAULT 'RECEIVED', -- RECEIVED | DONE | IGNORED | FAILED
  message       text,
  invoice_id    uuid,
  credit_note_id uuid,
  payload       jsonb,
  attempts      int NOT NULL DEFAULT 1,
  is_test       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS salla_events_company_idx ON salla_events(company_id, created_at DESC);

INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, is_cash_bank, system_key)
  SELECT p.company_id, '110204', 'حساب تسوية المتجر الإلكتروني (سلة)', 'E-store Clearing (Salla)', 'ASSET', 'BANK', p.id, 4, false, true, true, 'ESTORE_CLEARING'
  FROM accounts p WHERE p.code = '1102' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id = p.company_id AND (x.code = '110204' OR x.system_key = 'ESTORE_CLEARING'));

-- inter-branch current account: nets to zero company-wide; per branch it shows what the branch owes / is owed
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
  SELECT p.company_id, '110504', 'جاري الفروع (حساب وسيط بين الفروع)', 'Inter-branch Current Account', 'ASSET', 'CURRENT_ASSET', p.id, 4, false, true, 'INTER_BRANCH'
  FROM accounts p WHERE p.code = '1105' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id = p.company_id AND (x.code = '110504' OR x.system_key = 'INTER_BRANCH'));
