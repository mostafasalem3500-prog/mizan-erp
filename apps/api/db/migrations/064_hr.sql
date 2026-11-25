-- 3.52.0: human resources — employee file (identity, contract, GOSI registration), effective-dated GOSI rates by
-- scheme, leave types and requests with approval, documents with expiry, salary change history, payroll approval.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_type text;              -- NATIONAL_ID | IQAMA | PASSPORT | BORDER
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender text;               -- M | F
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS country text;              -- nationality as a country, for the file and Nitaqat
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type text;        -- INDEFINITE | FIXED | PART_TIME
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_end date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS probation_end date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gosi_reg_date date;        -- first registration: decides the old or new GOSI scheme
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gosi_scheme text;          -- OLD | NEW (overrides the date)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gosi_number text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS manager_id uuid;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_location text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS notes text;

-- GOSI contribution rates by scheme, nationality and branch, each with the date it starts. Rows with no company are
-- the published defaults; an establishment may add its own rows (a later effective date wins).
CREATE TABLE IF NOT EXISTS hr_gosi_rates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES companies(id) ON DELETE CASCADE,
  scheme         text NOT NULL,          -- OLD | NEW
  nationality    text NOT NULL,          -- SAUDI | NON_SAUDI
  branch         text NOT NULL,          -- PENSION | SANED | HAZARD
  employee_pct   numeric(6,3) NOT NULL DEFAULT 0,
  employer_pct   numeric(6,3) NOT NULL DEFAULT 0,
  effective_from date NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_gosi_rates_idx ON hr_gosi_rates (company_id, scheme, nationality, branch, effective_from);
CREATE TABLE IF NOT EXISTS hr_gosi_limits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES companies(id) ON DELETE CASCADE,
  min_base       numeric(18,2) NOT NULL DEFAULT 0,
  max_base       numeric(18,2) NOT NULL,
  effective_from date NOT NULL,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- the published rates (gosi.gov.sa; Social Insurance Law M/273 for new entrants from 3 July 2024: the pension
-- branch rises half a point a side each July from 2025 to 11% in 2028). Review against GOSI before relying on them.
INSERT INTO hr_gosi_rates (company_id, scheme, nationality, branch, employee_pct, employer_pct, effective_from, note)
SELECT NULL, v.scheme, v.nat, v.branch, v.e, v.r, v.d::date, v.note FROM (VALUES
  ('OLD', 'SAUDI', 'PENSION', 9, 9, '2000-01-01', 'المعاشات — النظام السابق'),
  ('OLD', 'SAUDI', 'SANED', 0.75, 0.75, '2000-01-01', 'ساند'),
  ('OLD', 'SAUDI', 'HAZARD', 0, 2, '2000-01-01', 'الأخطار المهنية'),
  ('OLD', 'NON_SAUDI', 'HAZARD', 0, 2, '2000-01-01', 'الأخطار المهنية'),
  ('NEW', 'SAUDI', 'PENSION', 9, 9, '2024-07-03', 'المعاشات — النظام الجديد'),
  ('NEW', 'SAUDI', 'PENSION', 9.5, 9.5, '2025-07-01', 'زيادة تدريجية'),
  ('NEW', 'SAUDI', 'PENSION', 10, 10, '2026-07-01', 'زيادة تدريجية'),
  ('NEW', 'SAUDI', 'PENSION', 10.5, 10.5, '2027-07-01', 'زيادة تدريجية'),
  ('NEW', 'SAUDI', 'PENSION', 11, 11, '2028-07-01', 'زيادة تدريجية'),
  ('NEW', 'SAUDI', 'SANED', 0.75, 0.75, '2024-07-03', 'ساند'),
  ('NEW', 'SAUDI', 'HAZARD', 0, 2, '2024-07-03', 'الأخطار المهنية'),
  ('NEW', 'NON_SAUDI', 'HAZARD', 0, 2, '2024-07-03', 'الأخطار المهنية')
) AS v(scheme, nat, branch, e, r, d, note)
WHERE NOT EXISTS (SELECT 1 FROM hr_gosi_rates WHERE company_id IS NULL);
INSERT INTO hr_gosi_limits (company_id, min_base, max_base, effective_from, note)
SELECT NULL, 0, 45000, '2000-01-01', 'الحد الأعلى للأجر الخاضع للاشتراك'
WHERE NOT EXISTS (SELECT 1 FROM hr_gosi_limits WHERE company_id IS NULL);

-- leave types: what each kind of leave pays, how long, for whom (seeded per establishment on first use)
CREATE TABLE IF NOT EXISTS hr_leave_types (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'OTHER',  -- ANNUAL | SICK | MATERNITY | PATERNITY | MARRIAGE | BEREAVEMENT | HAJJ | EXAM | IDDAH | UNPAID | OTHER
  max_days       numeric(6,2),                   -- null = no cap
  per            text NOT NULL DEFAULT 'OCCURRENCE', -- OCCURRENCE | YEAR | SERVICE (once in the whole service)
  tiers          jsonb NOT NULL DEFAULT '[]',    -- [{days, pct}] paid share over a rolling year (sick leave); empty = pct below
  paid_pct       numeric(6,2) NOT NULL DEFAULT 100,
  gender         text NOT NULL DEFAULT 'ANY',    -- ANY | F | M
  min_service_months int NOT NULL DEFAULT 0,
  needs_document boolean NOT NULL DEFAULT false,
  uses_balance   boolean NOT NULL DEFAULT false, -- annual leave: taken from the accrued balance
  is_active      boolean NOT NULL DEFAULT true,
  sort           int NOT NULL DEFAULT 0,
  note           text,
  UNIQUE (company_id, code)
);

ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'APPROVED'; -- PENDING | APPROVED | REJECTED | CANCELLED
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS type_id uuid;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS pay jsonb;               -- [{days, pct}] how the days are paid
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS decision_note text;
ALTER TABLE employee_leaves ADD COLUMN IF NOT EXISTS return_date date;        -- actual return (early or late)

CREATE TABLE IF NOT EXISTS hr_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind         text NOT NULL,      -- NATIONAL_ID | IQAMA | PASSPORT | WORK_PERMIT | HEALTH_INSURANCE | CONTRACT | DRIVING_LICENSE | CERTIFICATE | MEDICAL | OTHER
  number       text,
  issue_date   date,
  expiry_date  date,
  issuer       text,
  notes        text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_documents_exp_idx ON hr_documents (company_id, expiry_date);

CREATE TABLE IF NOT EXISTS hr_salary_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id    uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  old_pay        jsonb NOT NULL,
  new_pay        jsonb NOT NULL,
  reason         text,
  status         text NOT NULL DEFAULT 'PENDING',  -- PENDING | APPLIED | CANCELLED
  applied_at     timestamptz,
  is_demo        boolean NOT NULL DEFAULT false,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hr_salary_changes_idx ON hr_salary_changes (company_id, status, effective_date);

ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_at timestamptz;
