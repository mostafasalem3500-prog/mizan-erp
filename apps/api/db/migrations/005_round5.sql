-- Round 5: HR provisions (end-of-service & leave), employee loans, final settlements, budgets

-- ── employees: leave & termination data ───────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_days_per_year int NOT NULL DEFAULT 21;   -- 21 (<5 yrs) / 30 (>=5 yrs) per Saudi labor law art. 109
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_opening numeric(8,2) NOT NULL DEFAULT 0; -- leave days balance as of leave_balance_date
ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_balance_date date;                     -- accrual computed from this date (default: hire date)
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_date date;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS termination_reason text;                     -- TERMINATION | RESIGNATION | CONTRACT_END | ART80 (no EOSB)

CREATE TABLE IF NOT EXISTS employee_leaves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'ANNUAL', -- ANNUAL | SICK | UNPAID | OTHER
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  days        numeric(6,2) NOT NULL,
  notes       text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employee_leaves_emp_idx ON employee_leaves(company_id, employee_id);

CREATE TABLE IF NOT EXISTS employee_loans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  number       text NOT NULL,
  date         date NOT NULL,
  amount       numeric(18,2) NOT NULL,
  installment  numeric(18,2) NOT NULL,
  paid         numeric(18,2) NOT NULL DEFAULT 0,
  start_period text,                   -- first payroll period (YYYY-MM) to deduct from
  status       text NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | SETTLED | CANCELLED
  account_id   uuid,                   -- cash/bank account the loan was paid from
  journal_id   uuid,
  notes        text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- Per-employee provision sub-ledger: +provision, -release/usage. Σ per type must equal the GL provision account.
CREATE TABLE IF NOT EXISTS employee_provision_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type        text NOT NULL, -- EOSB | LEAVE
  date        date NOT NULL,
  amount      numeric(18,2) NOT NULL,
  source_type text NOT NULL, -- PROVISION | SETTLEMENT | OPENING
  source_id   uuid,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS epl_emp_idx ON employee_provision_ledger(company_id, employee_id, type);

CREATE TABLE IF NOT EXISTS hr_provisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period      text NOT NULL, -- YYYY-MM
  date        date NOT NULL,
  status      text NOT NULL DEFAULT 'DRAFT', -- DRAFT | POSTED
  lines       jsonb NOT NULL,
  total_eosb  numeric(18,2) NOT NULL DEFAULT 0,
  total_leave numeric(18,2) NOT NULL DEFAULT 0,
  journal_id  uuid,
  notes       text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period)
);

CREATE TABLE IF NOT EXISTS employee_settlements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  number           text NOT NULL,
  date             date NOT NULL,
  reason           text NOT NULL, -- TERMINATION | RESIGNATION | CONTRACT_END | ART80
  status           text NOT NULL DEFAULT 'DRAFT', -- DRAFT | POSTED | PAID
  data             jsonb NOT NULL, -- full computation snapshot
  net              numeric(18,2) NOT NULL DEFAULT 0,
  journal_id       uuid,
  pay_journal_id   uuid,
  notes            text,
  is_demo          boolean NOT NULL DEFAULT false,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- ── budgets ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  year       int  NOT NULL,
  status     text NOT NULL DEFAULT 'DRAFT', -- DRAFT | APPROVED
  notes      text,
  is_demo    boolean NOT NULL DEFAULT false,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, year, name)
);
CREATE TABLE IF NOT EXISTS budget_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id      uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  cost_center_id uuid,
  months         jsonb NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0,0,0]'
);
CREATE UNIQUE INDEX IF NOT EXISTS budget_lines_uq ON budget_lines(budget_id, account_id, COALESCE(cost_center_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── chart of accounts: HR keys & new accounts for existing companies ──────
UPDATE accounts SET system_key='EMP_ADVANCES'   WHERE code='110303' AND system_key IS NULL;
UPDATE accounts SET system_key='EOSB_PROVISION' WHERE code='2201'   AND system_key IS NULL;

INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '210304', 'مخصص الإجازات المستحقة', 'Leave Provision', 'LIABILITY', 'CURRENT_LIABILITY', p.id, 4, false, true, 'LEAVE_PROVISION'
FROM accounts p WHERE p.code='2103'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='210304' OR x.system_key='LEAVE_PROVISION'));

INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5215', 'مكافأة نهاية الخدمة', 'End of Service Expense', 'EXPENSE', 'EXPENSE', p.id, 3, false, true, 'EOSB_EXPENSE'
FROM accounts p WHERE p.code='52'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5215' OR x.system_key='EOSB_EXPENSE'));

INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5216', 'مصروف الإجازات المستحقة', 'Leave Expense', 'EXPENSE', 'EXPENSE', p.id, 3, false, true, 'LEAVE_EXPENSE'
FROM accounts p WHERE p.code='52'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5216' OR x.system_key='LEAVE_EXPENSE'));

-- VAT filing frequency (drives the "next return due" alert)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS vat_period text NOT NULL DEFAULT 'QUARTERLY'; -- MONTHLY | QUARTERLY
