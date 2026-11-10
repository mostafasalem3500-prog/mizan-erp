-- Executive analytics digest by email, and the document archive.

-- who receives management reports, what each one is allowed to see, and how often
CREATE TABLE IF NOT EXISTS report_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  email        text NOT NULL,
  title        text,                                   -- job title, shown in the list
  sections     text[] NOT NULL DEFAULT '{summary}',    -- summary sales purchases expenses inventory receivables payables cash alerts
  frequency    text NOT NULL DEFAULT 'DAILY',          -- DAILY | WEEKLY | MONTHLY
  branch_id    uuid,                                   -- limit the figures to one branch
  is_active    boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, email)
);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS digest jsonb NOT NULL DEFAULT '{}'::jsonb;   -- { enabled, hour, lastRun }
CREATE TABLE IF NOT EXISTS report_send_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email       text NOT NULL,
  period      text NOT NULL,
  ok          boolean NOT NULL,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_send_log_idx ON report_send_log(company_id, created_at DESC);

-- archive: every attachment gets a category, tags, a document date and an optional expiry (licences, contracts…)
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS tags text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS doc_date date;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS expires_at date;
CREATE INDEX IF NOT EXISTS attachments_company_idx ON attachments(company_id, created_at DESC);
