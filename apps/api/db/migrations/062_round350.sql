-- 3.50.0: manufacturing — frozen standard cost, serial numbers and operator per move; rentals (equipment, vehicles,
-- property and units) with contracts, deposits, periodic billing, returns and maintenance windows.
ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS frozen_cost numeric(18,4);
ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS frozen_detail jsonb;
ALTER TABLE mfg_moves ADD COLUMN IF NOT EXISTS operator text;
ALTER TABLE mfg_moves ADD COLUMN IF NOT EXISTS serials jsonb;
ALTER TABLE mfg_moves ADD COLUMN IF NOT EXISTS invoice_id uuid;

CREATE TABLE IF NOT EXISTS rental_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'EQUIPMENT',   -- EQUIPMENT | VEHICLE | PROPERTY | UNIT | OTHER
  category       text,
  identifier     text,                                -- plate, serial or unit number
  rate_hour      numeric(18,2) NOT NULL DEFAULT 0,
  rate_day       numeric(18,2) NOT NULL DEFAULT 0,
  rate_week      numeric(18,2) NOT NULL DEFAULT 0,
  rate_month     numeric(18,2) NOT NULL DEFAULT 0,
  deposit        numeric(18,2) NOT NULL DEFAULT 0,
  meter          numeric(18,2),
  meter_unit     text,
  cost_value     numeric(18,2) NOT NULL DEFAULT 0,    -- what the asset cost, for the return on it
  fixed_asset_id uuid,
  cost_center_id uuid,
  maintenance    boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  notes          text,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS rental_contracts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number           text NOT NULL,
  partner_id       uuid NOT NULL,
  status           text NOT NULL DEFAULT 'DRAFT',     -- DRAFT | RESERVED | ACTIVE | RETURNED | CLOSED | CANCELLED
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  delivered_date   date,
  returned_date    date,
  billing          text NOT NULL DEFAULT 'UPFRONT',   -- UPFRONT | MONTHLY
  lines            jsonb NOT NULL DEFAULT '[]',
  tax_code         text NOT NULL DEFAULT 'S',
  discount_pct     numeric(6,2) NOT NULL DEFAULT 0,
  deposit          numeric(18,2) NOT NULL DEFAULT 0,  -- required
  deposit_received numeric(18,2) NOT NULL DEFAULT 0,
  deposit_applied  numeric(18,2) NOT NULL DEFAULT 0,
  deposit_refunded numeric(18,2) NOT NULL DEFAULT 0,
  late_fee_day     numeric(18,2),                     -- per day late; null = each asset's daily rate
  invoiced_to      date,
  next_bill_date   date,
  charges          jsonb NOT NULL DEFAULT '[]',       -- damages and extras on return
  cost_center_id   uuid,
  notes            text,
  terms            text,
  created_by       text,
  is_demo          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS rental_contracts_dates_idx ON rental_contracts (company_id, status, start_date, end_date);

CREATE TABLE IF NOT EXISTS rental_moves (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL REFERENCES rental_contracts(id) ON DELETE CASCADE,
  kind        text NOT NULL,   -- DEPOSIT_IN | DEPOSIT_OUT | DEPOSIT_APPLY | INVOICE | DELIVER | RETURN | EXTEND | CANCEL
  date        date NOT NULL,
  amount      numeric(18,2) NOT NULL DEFAULT 0,
  period_from date,
  period_to   date,
  detail      jsonb,           -- invoice: per asset amounts; return: meters and condition
  entry_id    uuid,
  invoice_id  uuid,
  notes       text,
  created_by  text,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rental_moves_contract_idx ON rental_moves (contract_id, created_at);

CREATE TABLE IF NOT EXISTS rental_maintenance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  asset_id    uuid NOT NULL REFERENCES rental_assets(id) ON DELETE CASCADE,
  from_date   date NOT NULL,
  to_date     date NOT NULL,
  description text,
  cost        numeric(18,2) NOT NULL DEFAULT 0,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
