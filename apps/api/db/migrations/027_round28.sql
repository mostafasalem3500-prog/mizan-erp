-- Round 28: promotions (offers) engine, customer loyalty points, document attachments.

CREATE TABLE IF NOT EXISTS promotions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'PERCENT',      -- PERCENT | FIXED_PRICE | BUY_X_GET_Y
  scope        text NOT NULL DEFAULT 'ALL',          -- ALL | PRODUCTS | CATEGORIES
  product_ids  uuid[] NOT NULL DEFAULT '{}',
  category_ids uuid[] NOT NULL DEFAULT '{}',
  value        numeric(18,4) NOT NULL DEFAULT 0,     -- % (PERCENT) or special unit price (FIXED_PRICE)
  buy_qty      numeric(18,3) NOT NULL DEFAULT 0,
  get_qty      numeric(18,3) NOT NULL DEFAULT 0,
  min_qty      numeric(18,3) NOT NULL DEFAULT 0,
  min_total    numeric(18,2) NOT NULL DEFAULT 0,     -- the whole ticket must reach this
  date_from    date,
  date_to      date,
  days         int[] NOT NULL DEFAULT '{}',          -- 0=Sunday … 6=Saturday; empty = every day
  time_from    text,                                 -- HH:MM (Riyadh time); empty = all day
  time_to      text,
  channels     text[] NOT NULL DEFAULT '{POS,SALES}',
  priority     int NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS promotions_company_idx ON promotions(company_id, is_active);
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS promotion_id uuid;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS promo_discount numeric(18,2) NOT NULL DEFAULT 0;

-- loyalty: settings on the company, a points ledger per customer
ALTER TABLE companies ADD COLUMN IF NOT EXISTS loyalty jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  invoice_id  uuid,
  kind        text NOT NULL,                         -- EARN | REDEEM | REVERSE | ADJUST | EXPIRE
  points      numeric(18,2) NOT NULL,                -- + earned / − used
  amount      numeric(18,2) NOT NULL DEFAULT 0,      -- SAR value (redeem) or basis (earn)
  note        text,
  expires_at  date,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loyalty_partner_idx ON loyalty_ledger(company_id, partner_id, created_at);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS points_redeemed numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS points_value numeric(18,2) NOT NULL DEFAULT 0;

-- attachments: receipts, contracts, supplier invoices… on any document
CREATE TABLE IF NOT EXISTS attachments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity      text NOT NULL,                         -- invoice | payment | expense | journal | partner | asset
  entity_id   uuid NOT NULL,
  name        text NOT NULL,
  mime        text NOT NULL,
  size        int NOT NULL,
  data        bytea NOT NULL,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_entity_idx ON attachments(company_id, entity, entity_id);
