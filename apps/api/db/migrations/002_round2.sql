-- Round 2: share links, bank reconciliation marks, salesperson on invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS invoices_share_token_uq ON invoices(share_token);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id),
  statement_date date NOT NULL,
  statement_balance numeric(18,2) NOT NULL,
  cleared_balance   numeric(18,2) NOT NULL,
  difference    numeric(18,2) NOT NULL,
  notes         text,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bank_cleared_lines (
  line_id        uuid PRIMARY KEY REFERENCES journal_lines(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  cleared_date   date NOT NULL,
  reconciliation_id uuid REFERENCES bank_reconciliations(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS bank_cleared_company_idx ON bank_cleared_lines(company_id);

-- login throttling survives restarts / multiple replicas
CREATE TABLE IF NOT EXISTS login_attempts (
  key         text PRIMARY KEY,
  failures    int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
