-- Payroll transactions entered during the month (overtime, bonuses, absence, lateness, penalties, other deductions);
-- the month's payroll run picks them up automatically.
CREATE TABLE IF NOT EXISTS payroll_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  period      text NOT NULL,                 -- YYYY-MM the item is paid / deducted in
  date        date NOT NULL,
  kind        text NOT NULL,                 -- OVERTIME BONUS COMMISSION ALLOWANCE | ABSENCE LATE PENALTY DEDUCTION
  qty         numeric(10,2),                 -- hours (overtime, late) or days (absence, penalty)
  factor      numeric(6,3),                  -- overtime multiplier
  amount      numeric(18,2) NOT NULL,
  manual      boolean NOT NULL DEFAULT false, -- amount typed by the user rather than computed from the wage
  note        text,
  status      text NOT NULL DEFAULT 'OPEN',  -- OPEN | INCLUDED
  run_id      uuid,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payroll_items_idx ON payroll_items(company_id, period, employee_id);
CREATE INDEX IF NOT EXISTS payroll_items_run_idx ON payroll_items(run_id) WHERE run_id IS NOT NULL;
