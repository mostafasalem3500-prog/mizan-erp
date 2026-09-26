-- Round 4: offline POS idempotency, payroll
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_client_ref_uq ON invoices(company_id, client_ref) WHERE client_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS employees (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code          text NOT NULL,
  name          text NOT NULL,
  job_title     text,
  department    text,
  nationality   text NOT NULL DEFAULT 'SAUDI', -- SAUDI | NON_SAUDI (affects GOSI rates)
  hire_date     date,
  iban          text,
  bank_name     text,
  basic         numeric(18,2) NOT NULL DEFAULT 0,
  housing       numeric(18,2) NOT NULL DEFAULT 0,
  transport     numeric(18,2) NOT NULL DEFAULT 0,
  other_allow   numeric(18,2) NOT NULL DEFAULT 0,
  gosi          boolean NOT NULL DEFAULT true,
  cost_center_id uuid,
  is_active     boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period        text NOT NULL, -- YYYY-MM
  date          date NOT NULL,
  status        text NOT NULL DEFAULT 'DRAFT', -- DRAFT | POSTED | PAID
  lines         jsonb NOT NULL,
  total_gross   numeric(18,2) NOT NULL DEFAULT 0,
  total_gosi_emp numeric(18,2) NOT NULL DEFAULT 0,
  total_gosi_er numeric(18,2) NOT NULL DEFAULT 0,
  total_deductions numeric(18,2) NOT NULL DEFAULT 0,
  total_net     numeric(18,2) NOT NULL DEFAULT 0,
  journal_id    uuid,
  pay_journal_id uuid,
  notes         text,
  is_demo       boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);

-- GOSI payable account key on existing charts
UPDATE accounts SET system_key='GOSI_PAYABLE' WHERE code='210302' AND system_key IS NULL;
UPDATE accounts SET system_key='GOSI_EXPENSE' WHERE code='5203' AND system_key IS NULL;
UPDATE accounts SET system_key='ALLOWANCES' WHERE code='5202' AND system_key IS NULL;
