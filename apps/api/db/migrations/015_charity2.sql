-- Round 17: charity — financial custody, purchase requests & receiving reports, refund requests, volunteer entitlements

ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS program_name text;
ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS period_from date;
ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS period_to date;
ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS source_type text;   -- CUSTODY | REFUND | NULL
ALTER TABLE charity_disbursements ADD COLUMN IF NOT EXISTS source_id uuid;

-- العهد المالية: طلب ← اعتماد ← صرف (قيد) ← تسوية (قيد)
CREATE TABLE IF NOT EXISTS charity_custody (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number           text NOT NULL,
  date             date NOT NULL,
  holder_name      text NOT NULL,
  partner_id       uuid REFERENCES partners(id),
  id_no            text,
  phone            text,
  department       text,
  job_title        text,
  project_id       uuid REFERENCES charity_projects(id),
  purpose          text NOT NULL,
  funding          text,
  amount           numeric(18,2) NOT NULL,
  needed_date      date,
  settle_due       date,
  method           text NOT NULL DEFAULT 'TRANSFER',
  justification    text,
  status           text NOT NULL DEFAULT 'REQUESTED', -- REQUESTED | REVIEWED | APPROVED | REJECTED | DISBURSED | SETTLED
  review_note      text,
  approved_amount  numeric(18,2),
  approved_by      text,
  approved_at      timestamptz,
  disbursed_amount numeric(18,2),
  disbursed_date   date,
  pay_account_id   uuid REFERENCES accounts(id),
  ref_no           text,
  disburse_journal_id uuid REFERENCES journal_entries(id),
  settlement       jsonb,      -- {date, lines:[{date,description,docNo,amount,accountId}], spent, returned, extra, returnAccountId, receiptRef, note, result}
  settle_journal_id uuid REFERENCES journal_entries(id),
  settled_by       text,
  settled_at       timestamptz,
  is_demo          boolean NOT NULL DEFAULT false,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

-- طلبات الشراء، محاضر الاستلام، طلبات الاسترداد (سير عمل بلا قيود مباشرة)
CREATE TABLE IF NOT EXISTS charity_forms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind          text NOT NULL,          -- PURCHASE | RECEIVING | REFUND
  number        text NOT NULL,
  date          date NOT NULL,
  status        text NOT NULL DEFAULT 'SUBMITTED',
  party         text,                   -- مقدم الطلب / المورد / المستفيد
  amount        numeric(18,2) NOT NULL DEFAULT 0,
  project_id    uuid REFERENCES charity_projects(id),
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  review        jsonb NOT NULL DEFAULT '{}'::jsonb,
  parent_id     uuid REFERENCES charity_forms(id),
  disbursement_id uuid REFERENCES charity_disbursements(id),
  decided_by    text,
  decided_at    timestamptz,
  is_demo       boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, number)
);
CREATE INDEX IF NOT EXISTS ch_forms_idx ON charity_forms(company_id, kind, date);
