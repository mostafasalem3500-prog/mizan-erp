-- 3.48.0: kitchen stations and how long each item took from the hall to «ready»
CREATE TABLE IF NOT EXISTS kitchen_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id    uuid,
  order_no    text,
  product_id  uuid,
  name        text,
  station     text,
  qty         numeric(18,3) NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL,
  ready_at    timestamptz NOT NULL DEFAULT now(),
  minutes     numeric(10,2) NOT NULL DEFAULT 0,
  is_demo     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS kitchen_log_company_idx ON kitchen_log (company_id, ready_at);
