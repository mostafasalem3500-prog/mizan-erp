-- Associations edition: association type (non-profit / cooperative), members, subscriptions, member shares, surplus distribution

ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS assoc_type text NOT NULL DEFAULT 'CHARITY';   -- CHARITY | CIVIL | PROFESSIONAL | COOPERATIVE
ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS membership jsonb NOT NULL DEFAULT '{}'::jsonb;  -- {annualFee, shareValue, minShares, maxSharePct, dist:{reserve,capital,social,training,basis}}

ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_member boolean NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS member_info jsonb;                                       -- {no, kind, joinDate, status, iban, bankName}
CREATE INDEX IF NOT EXISTS partners_member_idx ON partners(company_id) WHERE is_member;

-- a membership-fee receipt names its member and the year it pays for
ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS fee_year int;

CREATE TABLE IF NOT EXISTS assoc_share_txns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number          text NOT NULL,
  date            date NOT NULL,
  partner_id      uuid NOT NULL REFERENCES partners(id),
  kind            text NOT NULL CHECK (kind IN ('SUBSCRIBE','REDEEM')),
  shares          int NOT NULL CHECK (shares > 0),
  unit_value      numeric(18,2) NOT NULL,
  amount          numeric(18,2) NOT NULL,
  cash_account_id uuid NOT NULL REFERENCES accounts(id),
  journal_id      uuid REFERENCES journal_entries(id),
  status          text NOT NULL DEFAULT 'POSTED',    -- POSTED | CANCELLED
  notes           text,
  is_demo         boolean NOT NULL DEFAULT false,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS assoc_share_partner_idx ON assoc_share_txns(company_id, partner_id);

CREATE TABLE IF NOT EXISTS assoc_distributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number         text NOT NULL,
  year           int NOT NULL,
  date           date NOT NULL,
  surplus        numeric(18,2) NOT NULL,
  reserve        numeric(18,2) NOT NULL DEFAULT 0,
  capital_return numeric(18,2) NOT NULL DEFAULT 0,
  social         numeric(18,2) NOT NULL DEFAULT 0,
  training       numeric(18,2) NOT NULL DEFAULT 0,
  tx_return      numeric(18,2) NOT NULL DEFAULT 0,
  retained       numeric(18,2) NOT NULL DEFAULT 0,
  basis          text NOT NULL DEFAULT 'TRANSACTIONS',   -- TRANSACTIONS | CAPITAL
  pcts           jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,     -- [{partnerId, name, shares, transactions, capitalReturn, txReturn, total, paid}]
  journal_id     uuid REFERENCES journal_entries(id),
  status         text NOT NULL DEFAULT 'POSTED',         -- POSTED | CANCELLED
  notes          text,
  is_demo        boolean NOT NULL DEFAULT false,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE UNIQUE INDEX IF NOT EXISTS assoc_dist_year_idx ON assoc_distributions(company_id, year) WHERE status='POSTED';

CREATE TABLE IF NOT EXISTS assoc_dist_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  distribution_id uuid NOT NULL REFERENCES assoc_distributions(id),
  partner_id      uuid NOT NULL REFERENCES partners(id),
  number          text NOT NULL,
  date            date NOT NULL,
  amount          numeric(18,2) NOT NULL,
  cash_account_id uuid NOT NULL REFERENCES accounts(id),
  journal_id      uuid REFERENCES journal_entries(id),
  status          text NOT NULL DEFAULT 'POSTED',
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
