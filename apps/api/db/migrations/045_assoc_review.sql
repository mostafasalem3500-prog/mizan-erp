-- Financial reviewer notes (associations edition): closing reminders, weekly/monthly closing log,
-- project final settlement, automatic daily backups

ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS closing jsonb NOT NULL DEFAULT '{}'::jsonb;  -- {daily, weekly, monthly, weekEndDay(0-6), requireDocs}

CREATE TABLE IF NOT EXISTS assoc_closings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('WEEKLY','MONTHLY')),
  period_key  text NOT NULL,          -- week: its last day (YYYY-MM-DD); month: YYYY-MM
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  summary     jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes       text,
  closed_by   text,
  closed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, period_key)
);

ALTER TABLE charity_projects ADD COLUMN IF NOT EXISTS final_settlement jsonb;
ALTER TABLE charity_projects ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE charity_projects ADD COLUMN IF NOT EXISTS closed_by text;

CREATE TABLE IF NOT EXISTS company_backups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  day         date NOT NULL,
  kind        text NOT NULL DEFAULT 'AUTO',   -- AUTO | MANUAL
  size        int NOT NULL,                   -- compressed bytes
  tables      int NOT NULL,
  rows        int NOT NULL,
  data        bytea NOT NULL,                 -- gzip(JSON)
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_backups_idx ON company_backups(company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS company_backups_auto_day ON company_backups(company_id, day) WHERE kind='AUTO';
