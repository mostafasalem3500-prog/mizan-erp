-- Round 9: lot / batch & expiry tracking (quantity sub-ledger; costing stays moving-average)
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_lots boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life_days int;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS block_expired_sales boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS stock_lots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL,
  lot_no       text NOT NULL,
  expiry_date  date,
  qty          numeric(18,3) NOT NULL DEFAULT 0,
  received_at  date NOT NULL,
  is_demo      boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, product_id, warehouse_id, lot_no)
);
CREATE INDEX IF NOT EXISTS stock_lots_fefo_idx ON stock_lots(company_id, product_id, warehouse_id, expiry_date NULLS LAST);

ALTER TABLE stock_moves ADD COLUMN IF NOT EXISTS lots jsonb;          -- [{lotNo, expiry, qty}]
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS lot_no text;        -- purchases: received lot
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS expiry_date date;
