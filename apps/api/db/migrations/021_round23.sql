-- Round 23: zakat base assessment, withholding tax (non-residents), charity zakat fund controls & case studies

-- withholding tax accounts for existing companies (new companies get them from the seeded chart)
INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key, is_cash_bank)
SELECT g.company_id, '210205', 'ضريبة الاستقطاع المستحقة', 'Withholding Tax Payable', 'LIABILITY', 'TAX', g.id, 4, false, true, 'WHT_PAYABLE', false
FROM accounts g WHERE g.code = '2102'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id = g.company_id AND (x.code = '210205' OR x.system_key = 'WHT_PAYABLE'));
INSERT INTO accounts (company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key, is_cash_bank)
SELECT g.company_id, '5217', 'ضريبة استقطاع تتحملها المنشأة', 'Withholding Tax Borne', 'EXPENSE', 'EXPENSE', g.id, 3, false, true, 'WHT_EXPENSE', false
FROM accounts g WHERE g.code = '52'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id = g.company_id AND (x.code = '5217' OR x.system_key = 'WHT_EXPENSE'));

ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_non_resident boolean NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS wht_type text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS country text;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS wht_type text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS wht_rate numeric(6,4);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS wht_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS wht_borne boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_paid numeric(18,2);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS wht_return_id uuid;

CREATE TABLE IF NOT EXISTS wht_returns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number         text NOT NULL,
  period         text NOT NULL,              -- YYYY-MM
  date           date NOT NULL,
  base_total     numeric(18,2) NOT NULL DEFAULT 0,
  tax_total      numeric(18,2) NOT NULL DEFAULT 0,
  pay_account_id uuid REFERENCES accounts(id),
  reference      text,
  journal_id     uuid,
  status         text NOT NULL DEFAULT 'POSTED',   -- POSTED | CANCELLED
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wht_returns_period_uq ON wht_returns(company_id, period) WHERE status = 'POSTED';

CREATE TABLE IF NOT EXISTS zakat_assessments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number          text NOT NULL,
  period_from     date NOT NULL,
  period_to       date NOT NULL,
  method          text NOT NULL DEFAULT 'GREGORIAN',   -- GREGORIAN (2.5776%) | HIJRI (2.5%)
  rate            numeric(8,6) NOT NULL,
  items           jsonb NOT NULL,
  adjusted_profit numeric(18,2) NOT NULL DEFAULT 0,
  base            numeric(18,2) NOT NULL DEFAULT 0,
  zakat           numeric(18,2) NOT NULL DEFAULT 0,
  journal_id      uuid,
  paid            numeric(18,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'POSTED',      -- POSTED | CANCELLED
  notes           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS zakat_assess_period_uq ON zakat_assessments(company_id, period_from, period_to) WHERE status = 'POSTED';
CREATE TABLE IF NOT EXISTS zakat_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES zakat_assessments(id) ON DELETE CASCADE,
  date          date NOT NULL,
  amount        numeric(18,2) NOT NULL,
  account_id    uuid NOT NULL REFERENCES accounts(id),
  reference     text,
  journal_id    uuid,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- charity: which fund a disbursement is paid from, and the Sharia zakat category
ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS fund text NOT NULL DEFAULT 'GENERAL';   -- GENERAL | ZAKAT
ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS zakat_category text;
ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS policy jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS charity_case_studies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partner_id     uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  number         text NOT NULL,
  date           date NOT NULL,
  members        int NOT NULL,
  income         numeric(18,2) NOT NULL DEFAULT 0,
  income_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  housing        text NOT NULL DEFAULT 'RENT',         -- RENT | OWN | FAMILY | OTHER
  rent           numeric(18,2) NOT NULL DEFAULT 0,
  debt_monthly   numeric(18,2) NOT NULL DEFAULT 0,
  debts_total    numeric(18,2) NOT NULL DEFAULT 0,
  flags          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ORPHAN, WIDOW, DIVORCED, DISABLED, CHRONIC, ELDERLY, UNEMPLOYED, STUDENT
  per_capita     numeric(18,2) NOT NULL DEFAULT 0,
  score          int NOT NULL DEFAULT 0,
  verdict        text NOT NULL,                        -- FAQIR | MISKEEN | NOT_ZAKAT
  zakat_eligible boolean NOT NULL DEFAULT false,
  needs          text,
  researcher     text,
  recommendation text,
  valid_until    date,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS charity_case_partner_idx ON charity_case_studies(partner_id, date DESC);
