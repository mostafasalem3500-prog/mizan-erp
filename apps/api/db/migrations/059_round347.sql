-- 3.47.0: category tree (main and sub categories), icon, order and visibility at the till
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES product_categories(id) ON DELETE SET NULL;
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS icon text;
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS sort int NOT NULL DEFAULT 0;
ALTER TABLE product_categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS product_categories_parent_idx ON product_categories (company_id, parent_id);
