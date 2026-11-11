-- Archive: content fingerprint to catch the same document filed twice.
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS sha256 text;
CREATE INDEX IF NOT EXISTS attachments_sha_idx ON attachments(company_id, sha256) WHERE sha256 IS NOT NULL;
-- Lists that filter on status inside one company (drafts, open documents) and the task counter in the top bar.
CREATE INDEX IF NOT EXISTS invoices_open_idx ON invoices(company_id, partner_id) WHERE status='POSTED' AND total - amount_paid > 0.001;
CREATE INDEX IF NOT EXISTS tasks_open_idx ON tasks(company_id, status, due_date);
-- Reports join accounts → journal lines by account; without this the planner read every tenant's lines for each report.
CREATE INDEX IF NOT EXISTS jl_account_idx ON journal_lines(account_id) INCLUDE (entry_id, debit, credit);
