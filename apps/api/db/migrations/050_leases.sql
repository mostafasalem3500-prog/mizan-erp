-- 3.37.0: leases under IFRS 16 (Saudi Arabia, SOCPA-endorsed) / EAS 49 (Egypt): right-of-use asset and lease liability.
-- Codes 1240/1241/2240/5240/5440 are kept clear of the ranges other editions extend.
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '1240', 'أصول حق الاستخدام', 'Right-of-use Assets', 'ASSET', 'FIXED_ASSET', p.id, 3, false, true, 'ROU_ASSET'
FROM accounts p WHERE p.code='12' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='1240' OR x.system_key='ROU_ASSET'));
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '1241', 'مجمع إهلاك أصول حق الاستخدام', 'Acc. Dep. Right-of-use Assets', 'ASSET', 'ACC_DEPRECIATION', p.id, 3, false, true, 'ROU_ACC_DEP'
FROM accounts p WHERE p.code='12' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='1241' OR x.system_key='ROU_ACC_DEP'));
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '2240', 'التزامات عقود الإيجار', 'Lease Liabilities', 'LIABILITY', 'LONG_TERM_LIABILITY', p.id, 3, false, true, 'LEASE_LIABILITY'
FROM accounts p WHERE p.code='22' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='2240' OR x.system_key='LEASE_LIABILITY'));
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5240', 'إهلاك أصول حق الاستخدام', 'Right-of-use Depreciation', 'EXPENSE', 'EXPENSE', p.id, 3, false, true, 'ROU_DEPRECIATION'
FROM accounts p WHERE p.code='52' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5240' OR x.system_key='ROU_DEPRECIATION'));
INSERT INTO accounts(company_id, code, name_ar, name_en, type, subtype, parent_id, level, is_group, is_system, system_key)
SELECT p.company_id, '5440', 'فوائد التزامات الإيجار', 'Interest on Lease Liabilities', 'EXPENSE', 'OTHER_EXPENSE', p.id, 3, false, true, 'LEASE_INTEREST'
FROM accounts p WHERE p.code='54' AND NOT EXISTS (SELECT 1 FROM accounts x WHERE x.company_id=p.company_id AND (x.code='5440' OR x.system_key='LEASE_INTEREST'));

CREATE TABLE IF NOT EXISTS leases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number           text NOT NULL,
  name             text NOT NULL,
  partner_id       uuid REFERENCES partners(id),
  start_date       date NOT NULL,
  months           int NOT NULL CHECK (months BETWEEN 13 AND 600),
  payment          numeric(18,2) NOT NULL CHECK (payment > 0),
  frequency        int NOT NULL CHECK (frequency IN (1,3,6,12)),
  timing           text NOT NULL CHECK (timing IN ('ADVANCE','ARREARS')),
  annual_rate      numeric(9,4) NOT NULL CHECK (annual_rate >= 0 AND annual_rate < 100),
  direct_costs     numeric(18,2) NOT NULL DEFAULT 0,
  liability0       numeric(18,2) NOT NULL,
  rou_cost         numeric(18,2) NOT NULL,
  pay_account_id   uuid REFERENCES accounts(id),
  cost_center_id   uuid REFERENCES cost_centers(id),
  branch_id        uuid,
  auto             boolean NOT NULL DEFAULT true,
  posted_months    int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED','TERMINATED')),
  start_entry_id   uuid REFERENCES journal_entries(id),
  end_entry_id     uuid REFERENCES journal_entries(id),
  ended_on         date,
  notes            text,
  is_demo          boolean NOT NULL DEFAULT false,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS leases_company ON leases(company_id, status);
-- one row per posted month (depreciation + interest) and per recorded payment
CREATE TABLE IF NOT EXISTS lease_posts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  lease_id      uuid NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('MONTH','PAYMENT')),
  n             int NOT NULL,
  date          date NOT NULL,
  interest      numeric(18,2) NOT NULL DEFAULT 0,
  depreciation  numeric(18,2) NOT NULL DEFAULT 0,
  payment       numeric(18,2) NOT NULL DEFAULT 0,
  vat           numeric(18,2) NOT NULL DEFAULT 0,
  entry_id      uuid NOT NULL REFERENCES journal_entries(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lease_id, kind, n)
);
