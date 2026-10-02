-- Round 8: public API keys, webhooks, customer portal
CREATE TABLE IF NOT EXISTS api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  prefix      text NOT NULL,           -- first chars shown in UI
  key_hash    text NOT NULL UNIQUE,    -- sha256 of the full key
  scopes      jsonb NOT NULL DEFAULT '["read"]',  -- read | write
  is_active   boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhooks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url         text NOT NULL,
  events      jsonb NOT NULL,
  secret      text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id  uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event       text NOT NULL,
  payload     jsonb NOT NULL,
  status      int,
  response    text,
  attempts    int NOT NULL DEFAULT 0,
  ok          boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_idx ON webhook_deliveries(webhook_id, created_at DESC);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS portal_token uuid;
CREATE UNIQUE INDEX IF NOT EXISTS partners_portal_token_uq ON partners(portal_token) WHERE portal_token IS NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_external_ref_uq ON invoices(company_id, external_ref) WHERE external_ref IS NOT NULL;
