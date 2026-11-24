-- 3.43.0: customer/supplier set-off entries, product recipes (ingredients consumed on sale), supplier bank details for the payment-run bank file
CREATE TABLE IF NOT EXISTS partner_setoffs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  number       text NOT NULL,
  date         date NOT NULL,
  partner_id   uuid NOT NULL REFERENCES partners(id),
  amount       numeric(18,2) NOT NULL,
  allocations  jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{invoiceId, number, side: AR|AP, amount}]
  memo         text,
  journal_id   uuid,
  status       text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','CANCELLED')),
  created_by   text,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, number)
);
CREATE INDEX IF NOT EXISTS partner_setoffs_partner_idx ON partner_setoffs (company_id, partner_id);

CREATE TABLE IF NOT EXISTS product_recipes (
  company_id   uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id uuid NOT NULL REFERENCES products(id),
  qty          numeric(18,4) NOT NULL CHECK (qty > 0),      -- base units of the component per one base unit sold
  sort         int NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, component_id)
);
CREATE INDEX IF NOT EXISTS product_recipes_company_idx ON product_recipes (company_id, component_id);

ALTER TABLE partners ADD COLUMN IF NOT EXISTS iban text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_beneficiary text;
