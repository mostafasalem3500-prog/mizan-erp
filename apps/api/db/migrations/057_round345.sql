-- 3.45.0: preparations (a stock item made from a recipe) with a batch output and a costing method, and production batches
CREATE TABLE IF NOT EXISTS recipe_headers (
  product_id  uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  output_qty  numeric(18,4) NOT NULL DEFAULT 1 CHECK (output_qty > 0),   -- what one batch of the recipe yields, in the item's unit
  method      text NOT NULL DEFAULT 'DIRECT' CHECK (method IN ('DIRECT','BATCH'))   -- DIRECT: sales take the raw ingredients; BATCH: cooked into stock first
);
CREATE TABLE IF NOT EXISTS prep_batches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  date         date NOT NULL,
  product_id   uuid NOT NULL REFERENCES products(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  input_qty    numeric(18,4) NOT NULL,
  expected_qty numeric(18,4) NOT NULL,
  output_qty   numeric(18,4) NOT NULL,
  cost         numeric(18,2) NOT NULL DEFAULT 0,
  lines        jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{componentId, name, qty, cost}]
  notes        text,
  status       text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_by   text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS prep_batches_product_idx ON prep_batches (company_id, product_id);
