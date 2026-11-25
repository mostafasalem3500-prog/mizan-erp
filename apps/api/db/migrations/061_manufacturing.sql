-- 3.49.0: manufacturing — work centres, bills of materials (multi-level, stages, by-products, versions),
-- manufacturing orders with their material/time/production ledger, and disassembly (unbuild).
CREATE TABLE IF NOT EXISTS mfg_work_centers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code            text NOT NULL,
  name            text NOT NULL,
  kind            text NOT NULL DEFAULT 'MACHINE',      -- MACHINE | LABOR | LINE | ASSEMBLY | OUTSOURCE
  rate_hour       numeric(18,4) NOT NULL DEFAULT 0,      -- labour / operator cost per hour
  overhead_hour   numeric(18,4) NOT NULL DEFAULT 0,      -- machine, power, depreciation… per hour
  rate_unit       numeric(18,4) NOT NULL DEFAULT 0,      -- per unit produced (outsourced operations)
  capacity_hours  numeric(10,2) NOT NULL DEFAULT 8,      -- per day, per unit of capacity
  units           integer NOT NULL DEFAULT 1,            -- machines / workers in parallel
  efficiency_pct  numeric(6,2) NOT NULL DEFAULT 100,
  cost_center_id  uuid,
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS mfg_boms (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES products(id),
  code        text NOT NULL,
  version     integer NOT NULL DEFAULT 1,
  name        text,
  kind        text NOT NULL DEFAULT 'MANUFACTURE',     -- MANUFACTURE | KIT (phantom: exploded into the parent's components)
  output_qty  numeric(18,4) NOT NULL DEFAULT 1,          -- the batch the quantities are written for
  lot_qty     numeric(18,4),                             -- usual run size: set-up time is spread over it in the standard cost
  lines       jsonb NOT NULL DEFAULT '[]',               -- [{componentId, qty, wastePct, opSeq, note}]
  ops         jsonb NOT NULL DEFAULT '[]',               -- [{seq, name, workCenterId, setupMin, runMin, qc, instructions}]
  byproducts  jsonb NOT NULL DEFAULT '[]',               -- [{productId, qty, sharePct}]
  is_default  boolean NOT NULL DEFAULT true,
  is_active   boolean NOT NULL DEFAULT true,
  notes       text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX IF NOT EXISTS mfg_boms_product_idx ON mfg_boms (company_id, product_id);

CREATE TABLE IF NOT EXISTS mfg_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number              text NOT NULL,
  date                date NOT NULL,
  product_id          uuid NOT NULL REFERENCES products(id),
  bom_id              uuid REFERENCES mfg_boms(id) ON DELETE SET NULL,
  qty                 numeric(18,4) NOT NULL,
  produced_qty        numeric(18,4) NOT NULL DEFAULT 0,
  scrap_qty           numeric(18,4) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'DRAFT',      -- DRAFT | CONFIRMED | IN_PROGRESS | DONE | CANCELLED
  priority            integer NOT NULL DEFAULT 2,          -- 1 urgent · 2 normal · 3 low
  planned_start       date,
  due_date            date,
  warehouse_id        uuid NOT NULL,                       -- materials come from here
  output_warehouse_id uuid NOT NULL,                       -- the product goes here
  partner_id          uuid,
  sales_ref           text,
  parent_id           uuid REFERENCES mfg_orders(id) ON DELETE SET NULL,
  cost_center_id      uuid,
  lot_no              text,
  expiry_date         date,
  notes               text,
  materials           jsonb NOT NULL DEFAULT '[]',
  ops                 jsonb NOT NULL DEFAULT '[]',
  byproducts          jsonb NOT NULL DEFAULT '[]',
  std_unit_cost       numeric(18,4) NOT NULL DEFAULT 0,
  wip                 numeric(18,2) NOT NULL DEFAULT 0,   -- what is in «work in process» for this order now
  material_cost       numeric(18,2) NOT NULL DEFAULT 0,
  conversion_cost     numeric(18,2) NOT NULL DEFAULT 0,
  received_value      numeric(18,2) NOT NULL DEFAULT 0,
  scrap_value         numeric(18,2) NOT NULL DEFAULT 0,
  variance            numeric(18,2) NOT NULL DEFAULT 0,
  closed_at           timestamptz,
  created_by          text,
  is_demo             boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS mfg_orders_status_idx ON mfg_orders (company_id, status, due_date);

CREATE TABLE IF NOT EXISTS mfg_moves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES mfg_orders(id) ON DELETE CASCADE,
  kind        text NOT NULL,      -- ISSUE | RETURN | LABOR | RECEIPT | BYPRODUCT | SCRAP | CLOSE | CANCEL
  date        date NOT NULL,
  product_id  uuid,
  qty         numeric(18,4) NOT NULL DEFAULT 0,
  value       numeric(18,2) NOT NULL DEFAULT 0,
  op_seq      integer,
  work_center_id uuid,
  minutes     numeric(12,2),
  entry_id    uuid,
  notes       text,
  created_by  text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mfg_moves_order_idx ON mfg_moves (order_id, created_at);
CREATE INDEX IF NOT EXISTS mfg_moves_company_idx ON mfg_moves (company_id, date);

CREATE TABLE IF NOT EXISTS mfg_unbuilds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  date         date NOT NULL,
  product_id   uuid NOT NULL REFERENCES products(id),
  bom_id       uuid,
  warehouse_id uuid NOT NULL,
  qty          numeric(18,4) NOT NULL,
  value        numeric(18,2) NOT NULL DEFAULT 0,
  lines        jsonb NOT NULL DEFAULT '[]',
  notes        text,
  created_by   text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
