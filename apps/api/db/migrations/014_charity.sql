-- Round 16: charity / non-profit association interface (separate /charity link on the same ledger)

-- donors & beneficiaries are partners with extra flags
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_donor boolean NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_beneficiary boolean NOT NULL DEFAULT false;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS id_number text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS donor_type text;          -- INDIVIDUAL | ENTITY | COMPANY | OTHER
ALTER TABLE partners ADD COLUMN IF NOT EXISTS beneficiary_info jsonb;   -- family size, category, iban …
CREATE INDEX IF NOT EXISTS partners_donor_idx ON partners(company_id) WHERE is_donor;
CREATE INDEX IF NOT EXISTS partners_benef_idx ON partners(company_id) WHERE is_beneficiary;

CREATE TABLE IF NOT EXISTS charity_settings (
  company_id       uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  association_name text,
  license_no       text,
  authority        text,           -- جهة الإشراف (المركز الوطني لتنمية القطاع غير الربحي …)
  phone            text,
  email            text,
  address          text,
  signatories      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {preparer:{name,title}, finance:{…}, authority:{…}, cashier:{…}}
  templates        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- per-template overrides
  theme            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {color, accent, showSeal, …}
  default_ui       boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS charity_projects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code           text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'PROGRAM',  -- PROGRAM | PROJECT | CAMPAIGN | ENDOWMENT
  restricted     boolean NOT NULL DEFAULT false,
  target         numeric(18,2) NOT NULL DEFAULT 0,
  start_date     date,
  end_date       date,
  status         text NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | CLOSED
  cost_center_id uuid REFERENCES cost_centers(id),
  description    text,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE IF NOT EXISTS charity_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number             text NOT NULL,
  date               date NOT NULL,
  partner_id         uuid REFERENCES partners(id),
  payer_name         text NOT NULL,
  payer_id_no        text,
  payer_phone        text,
  payer_type         text NOT NULL DEFAULT 'INDIVIDUAL',
  source             text NOT NULL DEFAULT 'CASH_DONATION', -- CASH_DONATION | SUPPORT | FOUNDING | PROGRAM | ZAKAT | REFUND | OTHER
  purpose            text,
  project_id         uuid REFERENCES charity_projects(id),
  restricted         boolean NOT NULL DEFAULT false,
  amount             numeric(18,2) NOT NULL,
  method             text NOT NULL DEFAULT 'CASH',          -- CASH | TRANSFER | CHEQUE | CARD
  cash_account_id    uuid NOT NULL REFERENCES accounts(id),
  revenue_account_id uuid NOT NULL REFERENCES accounts(id),
  bank_name          text,
  ref_no             text,
  deposit_date       date,
  notes              text,
  journal_id         uuid REFERENCES journal_entries(id),
  status             text NOT NULL DEFAULT 'POSTED',        -- POSTED | CANCELLED
  is_demo            boolean NOT NULL DEFAULT false,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS ch_rcpt_date_idx ON charity_receipts(company_id, date);

CREATE TABLE IF NOT EXISTS charity_disbursements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number             text NOT NULL,
  date               date NOT NULL,
  kind               text NOT NULL DEFAULT 'CASH',   -- CASH | CHEQUE | TRANSFER
  partner_id         uuid REFERENCES partners(id),
  beneficiary_name   text NOT NULL,
  beneficiary_id_no  text,
  beneficiary_phone  text,
  capacity           text NOT NULL DEFAULT 'BENEFICIARY', -- VOLUNTEER | EMPLOYEE | SUPPLIER | BENEFICIARY | OTHER
  department         text,
  amount             numeric(18,2) NOT NULL,
  reason             text NOT NULL,
  project_id         uuid REFERENCES charity_projects(id),
  budget_line        text,
  expense_account_id uuid NOT NULL REFERENCES accounts(id),
  pay_account_id     uuid NOT NULL REFERENCES accounts(id),
  request_id         uuid,
  batch_id           uuid,
  bank_name          text,
  account_holder     text,
  iban               text,
  ref_no             text,
  exec_date          date,
  docs               jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes              text,
  journal_id         uuid REFERENCES journal_entries(id),
  status             text NOT NULL DEFAULT 'POSTED',
  is_demo            boolean NOT NULL DEFAULT false,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS ch_dsb_date_idx ON charity_disbursements(company_id, date);

CREATE TABLE IF NOT EXISTS charity_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number             text NOT NULL,
  date               date NOT NULL,
  requester          text NOT NULL,
  department         text,
  partner_id         uuid REFERENCES partners(id),
  beneficiary_name   text NOT NULL,
  beneficiary_id_no  text,
  purpose            text NOT NULL,
  project_id         uuid REFERENCES charity_projects(id),
  budget_line        text,
  expense_account_id uuid REFERENCES accounts(id),
  method             text NOT NULL DEFAULT 'TRANSFER',   -- TRANSFER | CHEQUE | CASH
  amount             numeric(18,2) NOT NULL,
  justification      text,
  attachments        jsonb NOT NULL DEFAULT '[]'::jsonb,
  review             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- finance review checklist
  status             text NOT NULL DEFAULT 'SUBMITTED',  -- DRAFT | SUBMITTED | REVIEWED | APPROVED | REJECTED | PAID
  decision_note      text,
  reviewed_by        text,
  reviewed_at        timestamptz,
  approved_by        text,
  approved_at        timestamptz,
  disbursement_id    uuid REFERENCES charity_disbursements(id),
  is_demo            boolean NOT NULL DEFAULT false,
  created_by         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE IF NOT EXISTS charity_batches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number         text NOT NULL,
  date           date NOT NULL,
  title          text NOT NULL,
  project_id     uuid REFERENCES charity_projects(id),
  pay_account_id uuid REFERENCES accounts(id),
  expense_account_id uuid REFERENCES accounts(id),
  kind           text NOT NULL DEFAULT 'TRANSFER',
  lines          jsonb NOT NULL DEFAULT '[]'::jsonb,
  total          numeric(18,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'DRAFT',  -- DRAFT | POSTED | CANCELLED
  notes          text,
  posted_by      text,
  posted_at      timestamptz,
  is_demo        boolean NOT NULL DEFAULT false,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);

CREATE TABLE IF NOT EXISTS charity_budget_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  year        int NOT NULL,
  kind        text NOT NULL DEFAULT 'EXPENSE',  -- REVENUE | EXPENSE
  name        text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id),
  project_id  uuid REFERENCES charity_projects(id),
  amount      numeric(18,2) NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ch_budget_idx ON charity_budget_lines(company_id, year);

CREATE TABLE IF NOT EXISTS charity_day_closings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  date        date NOT NULL,
  totals      jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_cash numeric(18,2) NOT NULL DEFAULT 0,
  counted_cash  numeric(18,2) NOT NULL DEFAULT 0,
  difference    numeric(18,2) NOT NULL DEFAULT 0,
  notes       text,
  closed_by   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, date)
);
