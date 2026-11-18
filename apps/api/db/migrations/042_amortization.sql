-- Amortisation schedules: prepaid expenses spread over the months they cover (rent, insurance, subscriptions) and
-- deferred revenue recognised as it is earned (a year's maintenance contract paid in advance).

-- roles the schedules default to (deferred revenue gets 210320: 210305–210308 are taken by the Egyptian chart and the
-- associations edition)
UPDATE accounts a SET system_key='PREPAID' WHERE a.code='110501' AND a.system_key IS NULL
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=a.company_id AND x.system_key='PREPAID');

INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '210320', 'إيرادات مؤجلة (مقبوضة مقدماً)', 'Deferred Revenue', 'LIABILITY', 'CURRENT_LIABILITY', p.id, 4, false, true, 'DEFERRED_REVENUE'
FROM accounts p WHERE p.code='2103'
  AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='210320' OR x.system_key='DEFERRED_REVENUE'));

CREATE TABLE IF NOT EXISTS amortizations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number            text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('PREPAID','DEFERRED')),
  name              text NOT NULL,
  partner_id        uuid REFERENCES partners(id),
  total             numeric(18,2) NOT NULL CHECK (total > 0),
  months            int NOT NULL CHECK (months BETWEEN 1 AND 120),
  start_date        date NOT NULL,
  source_account_id uuid NOT NULL REFERENCES accounts(id),
  target_account_id uuid NOT NULL REFERENCES accounts(id),
  cost_center_id    uuid REFERENCES cost_centers(id),
  branch_id         uuid,
  auto              boolean NOT NULL DEFAULT true,
  posted_months     int NOT NULL DEFAULT 0,
  posted_amount     numeric(18,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DONE','CANCELLED')),
  pay_entry_id      uuid REFERENCES journal_entries(id),
  notes             text,
  is_demo           boolean NOT NULL DEFAULT false,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS amortizations_company ON amortizations(company_id, status);

CREATE TABLE IF NOT EXISTS amortization_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amortization_id uuid NOT NULL REFERENCES amortizations(id) ON DELETE CASCADE,
  period_end      date NOT NULL,
  amount          numeric(18,2) NOT NULL,
  entry_id        uuid NOT NULL REFERENCES journal_entries(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (amortization_id, period_end)
);
