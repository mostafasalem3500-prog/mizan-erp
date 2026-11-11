-- Period-end close cockpit, parked journals with approval, bank reconciliation rules, cost allocation, cost behaviour.

-- journals saved without posting; posted only on approval (maker / checker)
CREATE TABLE IF NOT EXISTS journal_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date          date NOT NULL,
  memo          text,
  reference     text,
  lines         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{accountId, debit, credit, partnerId, costCenterId, description}]
  total         numeric(18,2) NOT NULL DEFAULT 0,
  reverse_on    date,                                 -- accrual: reversed automatically on this date when posted
  status        text NOT NULL DEFAULT 'DRAFT',        -- DRAFT | SUBMITTED | REJECTED | POSTED
  created_by    uuid,
  created_name  text,
  submitted_at  timestamptz,
  decided_by    uuid,
  decided_name  text,
  decided_at    timestamptz,
  reject_reason text,
  entry_id      uuid,
  reversal_id   uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journal_drafts_idx ON journal_drafts(company_id, status, date);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS accounting jsonb NOT NULL DEFAULT '{}'::jsonb;   -- { journalApproval }

-- bank statement: rules that book and match recurring lines (fees, interest, card settlement), and one line ↔ several entries
CREATE TABLE IF NOT EXISTS bank_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       text NOT NULL,
  contains   text NOT NULL,                 -- words looked for in the bank description / reference
  direction  text NOT NULL DEFAULT 'ANY',   -- ANY | IN | OUT
  account_id uuid NOT NULL,                 -- counter account
  tax_code   text,                          -- for expenses: S / O / E …
  is_active  boolean NOT NULL DEFAULT true,
  sort       int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bank_rules_idx ON bank_rules(company_id, sort);
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS matched_line_ids uuid[];
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS posted_entry_id uuid;   -- entry created from this line by a rule

-- month-end close: the manual steps ticked by the accountant (automatic checks are computed live)
CREATE TABLE IF NOT EXISTS period_close_tasks (
  period_id  uuid NOT NULL REFERENCES periods(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  key        text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  note       text,
  done_by    text,
  done_at    timestamptz,
  PRIMARY KEY (period_id, key)
);

-- cost allocation: move expenses of one cost centre (or the unassigned pool) onto others by percentages
CREATE TABLE IF NOT EXISTS cost_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  source_cc   uuid,                 -- NULL = expenses not assigned to any cost centre
  account_ids uuid[],               -- NULL = every expense account
  targets     jsonb NOT NULL,       -- [{costCenterId, pct}]
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cost_allocation_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  allocation_id uuid NOT NULL REFERENCES cost_allocations(id) ON DELETE CASCADE,
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  amount        numeric(18,2) NOT NULL,
  journal_id    uuid,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- cost-volume-profit: how each expense account behaves (NULL = default: cost of sales variable, the rest fixed)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS cost_behavior text;
