-- Error monitoring: unexpected server errors and errors in the browser, grouped per day so a repeating error is one
-- row with a count. Kept 30 days. Seen by the system's general manager only.
CREATE TABLE IF NOT EXISTS app_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day         date NOT NULL DEFAULT CURRENT_DATE,
  fingerprint text NOT NULL,
  source      text NOT NULL CHECK (source IN ('server','client')),
  message     text NOT NULL,
  stack       text,
  path        text,
  method      text,
  status      int,
  version     text,
  user_agent  text,
  company_id  uuid,
  user_id     uuid,
  count       int NOT NULL DEFAULT 1,
  first_at    timestamptz NOT NULL DEFAULT now(),
  last_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint, day)
);
CREATE INDEX IF NOT EXISTS app_errors_last ON app_errors(last_at DESC);
