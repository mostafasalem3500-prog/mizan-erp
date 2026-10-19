-- Round 22: controlled correction of posted purchase invoices (reverse + repost, same number, full revision log)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS revision int NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS invoice_revisions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id          uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  rev_no              int NOT NULL,
  reason              text NOT NULL,
  before              jsonb NOT NULL,
  after               jsonb NOT NULL,
  old_journal_id      uuid,
  reversal_journal_id uuid,
  new_journal_id      uuid,
  cogs_journal_id     uuid,
  cogs_adjustment     numeric(18,2) NOT NULL DEFAULT 0,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_revisions_inv_idx ON invoice_revisions(invoice_id, rev_no);
