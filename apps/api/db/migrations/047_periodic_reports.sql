-- 3.34.0: periodic written financial reports (monthly / quarterly / annual), kept as issued
CREATE TABLE IF NOT EXISTS periodic_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('MONTH','QUARTER','YEAR')),
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  title        text NOT NULL,
  level        text,
  health       int,
  data         jsonb NOT NULL,
  data_en      jsonb,
  auto         boolean NOT NULL DEFAULT false,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, kind, period_from)
);
CREATE INDEX IF NOT EXISTS periodic_reports_company ON periodic_reports(company_id, period_to DESC);
