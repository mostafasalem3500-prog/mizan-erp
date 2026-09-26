-- Round 7: units of measure (packs), reminders log, email settings

CREATE TABLE IF NOT EXISTS product_uoms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name           text NOT NULL,                 -- كرتون / علبة / درزن
  factor         numeric(12,3) NOT NULL CHECK (factor > 0), -- base units per pack
  barcode        text,
  sale_price     numeric(18,4),                 -- null → base price × factor
  purchase_price numeric(18,4),
  sort           int NOT NULL DEFAULT 0,
  UNIQUE (product_id, name)
);
CREATE INDEX IF NOT EXISTS product_uoms_barcode_idx ON product_uoms(company_id, barcode);

ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS uom text;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS factor numeric(12,3) NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partner_id  uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  channel     text NOT NULL, -- WHATSAPP | EMAIL | CALL | NOTE
  subject     text,
  body        text,
  amount_due  numeric(18,2),
  sent_by     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reminders_partner_idx ON reminders(company_id, partner_id, created_at DESC);
