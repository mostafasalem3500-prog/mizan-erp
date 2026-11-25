-- 3.51.0: subscriptions — plans, subscribers, recurring billing, trials, pause, plan changes, usage quotas and
-- check-ins; periods longer than a month go to deferred revenue and are recognised month by month.
CREATE TABLE IF NOT EXISTS sub_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           text NOT NULL,
  name           text NOT NULL,
  category       text,
  period         text NOT NULL DEFAULT 'MONTH',      -- WEEK | MONTH | QUARTER | HALF | YEAR
  price          numeric(18,2) NOT NULL DEFAULT 0,
  setup_fee      numeric(18,2) NOT NULL DEFAULT 0,
  trial_days     int NOT NULL DEFAULT 0,
  tax_code       text NOT NULL DEFAULT 'S',
  quota          numeric(18,2),                      -- visits / uses / units per period; null = unlimited
  quota_unit     text,
  overage_price  numeric(18,2) NOT NULL DEFAULT 0,   -- per use above the quota; 0 = no use above it
  grace_days     int NOT NULL DEFAULT 7,             -- unpaid invoice older than this: past due
  pausable       boolean NOT NULL DEFAULT true,
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number               text NOT NULL,
  partner_id           uuid NOT NULL,
  plan_id              uuid NOT NULL REFERENCES sub_plans(id),
  status               text NOT NULL DEFAULT 'ACTIVE', -- TRIAL | ACTIVE | PAUSED | CANCELLED | EXPIRED
  price                numeric(18,2) NOT NULL,          -- per period, per seat (snapshot or agreed price)
  qty                  numeric(18,2) NOT NULL DEFAULT 1,-- seats / units
  discount_pct         numeric(6,2) NOT NULL DEFAULT 0,
  start_date           date NOT NULL,
  trial_end            date,
  current_from         date,
  current_to           date,
  next_bill_date       date,
  end_date             date,                            -- fixed term: no renewal after it
  auto_renew           boolean NOT NULL DEFAULT true,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  cancelled_date       date,
  cancel_reason        text,
  paused_from          date,
  paused_until         date,
  pending_plan_id      uuid,
  pending_qty          numeric(18,2),
  setup_billed         boolean NOT NULL DEFAULT false,
  cost_center_id       uuid,
  notes                text,
  created_by           text,
  is_demo              boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS subscriptions_due_idx ON subscriptions (company_id, status, next_bill_date);

CREATE TABLE IF NOT EXISTS sub_moves (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  kind            text NOT NULL,   -- START | INVOICE | CREDIT | PAUSE | RESUME | CHANGE | CANCEL | EXPIRE
  date            date NOT NULL,
  amount          numeric(18,2) NOT NULL DEFAULT 0,
  period_from     date,
  period_to       date,
  invoice_id      uuid,
  amortization_id uuid,
  detail          jsonb,
  notes           text,
  created_by      text,
  is_demo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sub_moves_sub_idx ON sub_moves (subscription_id, created_at);

CREATE TABLE IF NOT EXISTS sub_usage (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  at              timestamptz NOT NULL DEFAULT now(),
  date            date NOT NULL,
  qty             numeric(18,2) NOT NULL DEFAULT 1,
  overage         boolean NOT NULL DEFAULT false,
  price           numeric(18,2) NOT NULL DEFAULT 0, -- per use above the quota, at the plan's price that day
  billed          boolean NOT NULL DEFAULT false,
  note            text,
  created_by      text,
  is_demo         boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sub_usage_sub_idx ON sub_usage (subscription_id, date);
