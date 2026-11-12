-- Projects are cost centres with a customer, a contract value, a cost budget and dates; centres can be nested so
-- one parent shows the total of its projects. Invoices carry the centre so revenue and purchases reach it.
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'CENTER';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE SET NULL;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS contract_value numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS budget numeric(16,2) NOT NULL DEFAULT 0;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS manager text;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS journal_lines_cc ON journal_lines(cost_center_id) WHERE cost_center_id IS NOT NULL;
