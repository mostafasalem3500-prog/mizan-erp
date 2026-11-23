-- 3.40.0: cashier oversell override, reversing a posted sales return, staff number on documents,
-- clearing reconciliation for card terminals and e-store platforms (per transaction, with fees), evidence on auditor notes

ALTER TABLE memberships ADD COLUMN IF NOT EXISTS staff_no text;
-- who issued the document (staff number at posting time) and whether stock was overridden at the till
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuer_no text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS oversold boolean NOT NULL DEFAULT false;
-- a posted sales return that was taken back: the debit note that reversed it
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS reversed_by uuid REFERENCES invoices(id);

-- one deposit from the card acquirer or the e-store platform, clearing the receivable they held for us
CREATE TABLE IF NOT EXISTS clearing_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source          text NOT NULL CHECK (source IN ('CARD','SALLA','ZID')),
  number          text NOT NULL,
  date            date NOT NULL,
  reference       text,
  bank_account_id uuid NOT NULL REFERENCES accounts(id),
  clearing_account_id uuid NOT NULL REFERENCES accounts(id),
  gross           numeric(18,2) NOT NULL,
  fees            numeric(18,2) NOT NULL DEFAULT 0,
  fee_vat         numeric(18,2) NOT NULL DEFAULT 0,
  net             numeric(18,2) NOT NULL,
  journal_id      uuid REFERENCES journal_entries(id),
  status          text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  notes           text,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clearing_batches_company ON clearing_batches(company_id, source, date);
-- each transaction in the deposit; invoice_id NULL = the statement has a transaction the books do not (flagged, not posted)
CREATE TABLE IF NOT EXISTS clearing_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  batch_id    uuid NOT NULL REFERENCES clearing_batches(id) ON DELETE CASCADE,
  source      text NOT NULL,
  invoice_id  uuid REFERENCES invoices(id),
  ref         text,
  txn_date    date,
  gross       numeric(18,2) NOT NULL,
  fee         numeric(18,2) NOT NULL DEFAULT 0,
  fee_vat     numeric(18,2) NOT NULL DEFAULT 0,
  resolved    boolean NOT NULL DEFAULT false,
  note        text
);
CREATE INDEX IF NOT EXISTS clearing_lines_invoice ON clearing_lines(invoice_id);
CREATE INDEX IF NOT EXISTS clearing_lines_batch ON clearing_lines(batch_id);

ALTER TABLE audit_dismissals ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE clearing_batches ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
