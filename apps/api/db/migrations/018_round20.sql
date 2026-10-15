-- Round 20: ERP punch list — salesperson, treasury details, transfers
ALTER TABLE partners ADD COLUMN IF NOT EXISTS salesperson text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS salesperson text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS iban text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bank_account_no text;
CREATE TABLE IF NOT EXISTS treasury_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number        text NOT NULL,
  date          date NOT NULL,
  from_account_id uuid NOT NULL REFERENCES accounts(id),
  to_account_id   uuid NOT NULL REFERENCES accounts(id),
  amount        numeric(18,2) NOT NULL,
  fee           numeric(18,2) NOT NULL DEFAULT 0,
  fee_vat       numeric(18,2) NOT NULL DEFAULT 0,
  reference     text,
  memo          text,
  journal_id    uuid REFERENCES journal_entries(id),
  status        text NOT NULL DEFAULT 'POSTED',
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
