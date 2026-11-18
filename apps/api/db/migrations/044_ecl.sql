-- Allowance for doubtful debts (expected credit losses, IFRS 9 simplified approach): a provision matrix over the
-- ageing of customer balances. Each run records the rates used, the required allowance and the adjusting entry.
UPDATE accounts a SET system_key='DOUBTFUL_ALLOWANCE' WHERE a.code='110304' AND a.system_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=a.company_id AND x.system_key='DOUBTFUL_ALLOWANCE');

-- 5230: kept clear of 5218–5229 so other editions can add accounts after 5217
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5230', 'مصروف الديون المشكوك في تحصيلها', 'Bad Debt Expense', 'EXPENSE', 'EXPENSE', p.id, 3, false, true, 'BAD_DEBT'
FROM accounts p WHERE p.code='52'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5230' OR x.system_key='BAD_DEBT'));

CREATE TABLE IF NOT EXISTS ecl_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  as_of       date NOT NULL,
  rates       jsonb NOT NULL,
  receivables numeric(18,2) NOT NULL,
  required    numeric(18,2) NOT NULL,
  existing    numeric(18,2) NOT NULL,
  adjustment  numeric(18,2) NOT NULL,
  entry_id    uuid REFERENCES journal_entries(id),
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ecl_runs_company ON ecl_runs(company_id, as_of DESC);
