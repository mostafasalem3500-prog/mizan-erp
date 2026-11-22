-- 3.39.0: Egyptian compliance round — payroll remittances (insurance / salary tax), simplified tax regime (Law 6/2025),
-- solidarity contribution, legal reserve, employee birth date (leave from age 50, gratuity after 60)

ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date date;

-- Egypt: the establishment opted into the simplified regime for projects with turnover up to EGP 20m (tax on turnover, quarterly VAT)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS eg_simplified boolean NOT NULL DEFAULT false;

-- what was paid to the insurance authority / the tax authority out of the payroll liabilities of one month
CREATE TABLE IF NOT EXISTS payroll_remittances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number      text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('INSURANCE','SALARY_TAX')),
  period      text NOT NULL,                 -- YYYY-MM of the payroll month
  date        date NOT NULL,
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  parts       jsonb NOT NULL DEFAULT '{}',   -- {insurance} or {salaryTax, martyrs}
  account_id  uuid NOT NULL REFERENCES accounts(id),
  reference   text,
  journal_id  uuid REFERENCES journal_entries(id),
  status      text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_remittances_company ON payroll_remittances(company_id, period);
