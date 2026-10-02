-- Round 12: multi-platform e-store connectors (Salla + Zid), platform payout settlement

-- one connection per (company, platform)
ALTER TABLE salla_connections ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'SALLA';
ALTER TABLE salla_connections DROP CONSTRAINT IF EXISTS salla_connections_pkey;
ALTER TABLE salla_connections ADD PRIMARY KEY (company_id, platform);
ALTER TABLE salla_events ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'SALLA';

-- platform payouts: clearing account → bank, net of the platform's commission and the VAT on it
CREATE TABLE IF NOT EXISTS estore_payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  platform        text NOT NULL,
  number          text NOT NULL,
  date            date NOT NULL,
  reference       text,
  gross           numeric(18,2) NOT NULL,
  fees            numeric(18,2) NOT NULL DEFAULT 0,
  fee_vat         numeric(18,2) NOT NULL DEFAULT 0,
  net             numeric(18,2) NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES accounts(id),
  clearing_account_id uuid NOT NULL REFERENCES accounts(id),
  journal_id      uuid,
  status          text NOT NULL DEFAULT 'POSTED',
  notes           text,
  is_demo         boolean NOT NULL DEFAULT false,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS estore_payouts_company_idx ON estore_payouts(company_id, date DESC);

INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
  SELECT p.company_id, '5304', 'عمولات ورسوم منصات البيع الإلكتروني', 'E-commerce Platform Fees', 'EXPENSE', 'SELLING_EXPENSE', p.id, 3, false, true, 'ESTORE_FEES'
  FROM accounts p WHERE p.code = '53' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id = p.company_id AND (x.code = '5304' OR x.system_key = 'ESTORE_FEES'));

-- the clearing account now serves every connected store
UPDATE accounts SET name_ar = 'حساب تسوية المتاجر الإلكترونية (سلة/زد)', name_en = 'E-store Clearing (Salla/Zid)'
  WHERE system_key = 'ESTORE_CLEARING' AND name_ar = 'حساب تسوية المتجر الإلكتروني (سلة)';
