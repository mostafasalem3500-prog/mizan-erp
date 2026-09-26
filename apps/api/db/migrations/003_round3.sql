-- Round 3: cheques register, recurring templates, notes receivable/payable system keys
UPDATE accounts SET system_key='NOTES_REC' WHERE code='110302' AND system_key IS NULL;
UPDATE accounts SET system_key='NOTES_PAY' WHERE code='210102' AND system_key IS NULL;

CREATE TABLE IF NOT EXISTS cheques (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('IN','OUT')),
  cheque_no     text NOT NULL,
  bank_name     text,
  partner_id    uuid NOT NULL REFERENCES partners(id),
  amount        numeric(18,2) NOT NULL CHECK (amount > 0),
  received_date date NOT NULL,
  due_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'PENDING', -- PENDING (in hand / issued) | DEPOSITED | CLEARED | BOUNCED | CANCELLED
  payment_id    uuid REFERENCES payments(id) ON DELETE SET NULL,
  bank_account_id uuid REFERENCES accounts(id),
  clear_journal_id uuid,
  notes         text,
  is_demo       boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cheques_company_idx ON cheques(company_id, status, due_date);

CREATE TABLE IF NOT EXISTS recurring_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('EXPENSE','JOURNAL','SALE_INVOICE')),
  name        text NOT NULL,
  frequency   text NOT NULL DEFAULT 'MONTHLY' CHECK (frequency IN ('WEEKLY','MONTHLY','QUARTERLY','YEARLY')),
  next_date   date NOT NULL,
  end_date    date,
  payload     jsonb NOT NULL,
  last_run    date,
  runs        int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_due_idx ON recurring_templates(next_date) WHERE is_active;
