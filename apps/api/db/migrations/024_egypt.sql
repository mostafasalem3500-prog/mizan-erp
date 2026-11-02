-- Egypt edition (MIZAN_COUNTRY=EG): Egyptian Tax Authority e-invoice / e-receipt, item codes, withholding, payroll.
-- Columns are harmless on the Saudi server (left empty there).
CREATE TABLE IF NOT EXISTS eta_configs (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  environment text NOT NULL DEFAULT 'MOCK',          -- MOCK (built-in simulator) | PREPROD | PROD
  client_id text, client_secret text,                -- ERP API credentials from the ETA portal
  rin text,                                          -- issuer tax registration number (9 digits)
  activity_code text,                                -- taxpayer activity code (4 digits)
  branch_code text NOT NULL DEFAULT '0',
  governate text, region_city text, street text, building_number text, postal_code text,
  document_version text NOT NULL DEFAULT '1.0',      -- 1.0 needs an e-seal signature; 0.9 is unsigned (pre-production only)
  signer_url text, signer_secret text,               -- local signing service that holds the USB token (CAdES-BES)
  pos_serial text, pos_os_version text, pos_model text, pos_client_id text, pos_client_secret text, pos_preshared_key text,
  receipt_last_uuid text,
  auto_submit boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_status text;          -- NOT_CONFIGURED | PENDING | NEEDS_SIGNATURE | SUBMITTED | VALID | INVALID | REJECTED | CANCELLED | FAILED
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_kind text;            -- INVOICE | RECEIPT
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_uuid text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_long_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_submission_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_document jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_response jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_errors jsonb;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS eta_submitted_at timestamptz;
CREATE INDEX IF NOT EXISTS invoices_eta_status_idx ON invoices(company_id, eta_status) WHERE eta_status IS NOT NULL;

ALTER TABLE products ADD COLUMN IF NOT EXISTS eta_item_type text;       -- EGS (internal code registered on the portal) | GS1
ALTER TABLE products ADD COLUMN IF NOT EXISTS eta_item_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS eta_unit_type text;       -- ETA unit code (EA, KGM, LTR, MTR, BOX…)

ALTER TABLE partners ADD COLUMN IF NOT EXISTS eta_type text;            -- B business | P person | F foreigner (default by data)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS governate text;

CREATE TABLE IF NOT EXISTS eta_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  action text NOT NULL, ok boolean NOT NULL, detail jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eta_log_company_idx ON eta_log(company_id, created_at DESC);

-- Egyptian payroll details per line live in payroll_runs.lines; totals for salary tax & martyrs fund
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_salary_tax numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_martyrs numeric(14,2) NOT NULL DEFAULT 0;
