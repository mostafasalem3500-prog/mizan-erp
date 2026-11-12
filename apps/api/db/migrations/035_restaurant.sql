-- Restaurant / café layer of the point of sale: halls, tables, and open orders that stay on a table until paid.
CREATE TABLE IF NOT EXISTS pos_floors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL, sort int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pos_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  floor_id uuid NOT NULL REFERENCES pos_floors(id) ON DELETE CASCADE, name text NOT NULL, seats int NOT NULL DEFAULT 4,
  sort int NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pos_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number int NOT NULL, type text NOT NULL DEFAULT 'DINE_IN' CHECK (type IN ('DINE_IN','TAKEAWAY','DELIVERY')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PAID','CANCELLED')),
  table_id uuid REFERENCES pos_tables(id) ON DELETE SET NULL, table_name text, guests int NOT NULL DEFAULT 1,
  partner_id uuid REFERENCES partners(id), customer_name text, customer_phone text, address text, notes text,
  lines jsonb NOT NULL DEFAULT '[]', total numeric(14,2) NOT NULL DEFAULT 0, waiter text, cancel_reason text,
  invoice_ids jsonb NOT NULL DEFAULT '[]', opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pos_orders_open ON pos_orders(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS pos_orders_one_per_table ON pos_orders(table_id) WHERE status='OPEN' AND table_id IS NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS pos_order_id uuid;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS table_name text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_type text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS order_no int;
