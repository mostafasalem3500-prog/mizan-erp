-- 3.55.0: item classification. How an item is bought (stock / service / ingredient — any combination) and how it is
-- sold (stock item / item with a recipe / service / not sold). `type` (STOCK|SERVICE) stays the engine's switch.
ALTER TABLE products ADD COLUMN IF NOT EXISTS buy_roles text[] NOT NULL DEFAULT '{}';      -- STOCK, SERVICE, COMPONENT
ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_class text;                              -- STOCK | RECIPE | SERVICE | NULL = not sold
ALTER TABLE products ADD COLUMN IF NOT EXISTS classed boolean NOT NULL DEFAULT false;       -- false: classification not set yet (filled from type below)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_class_chk') THEN
    ALTER TABLE products ADD CONSTRAINT products_sale_class_chk CHECK (sale_class IS NULL OR sale_class IN ('STOCK','RECIPE','SERVICE'));
  END IF;
END $$;
UPDATE products p SET classed = true,
  sale_class = CASE WHEN EXISTS (SELECT 1 FROM product_recipes r WHERE r.product_id = p.id) THEN 'RECIPE' WHEN p.type = 'SERVICE' THEN 'SERVICE' ELSE 'STOCK' END,
  buy_roles = (CASE WHEN p.type = 'SERVICE' THEN ARRAY['SERVICE'] ELSE ARRAY['STOCK'] END)
              || (CASE WHEN EXISTS (SELECT 1 FROM product_recipes r WHERE r.component_id = p.id) THEN ARRAY['COMPONENT'] ELSE ARRAY[]::text[] END)
  WHERE NOT p.classed;
CREATE INDEX IF NOT EXISTS products_component_idx ON products (company_id) WHERE 'COMPONENT' = ANY(buy_roles);
-- a preparation made in bulk may have a minimum run (a whole lamb, a 10 kg skewer)
ALTER TABLE recipe_headers ADD COLUMN IF NOT EXISTS min_batch numeric(18,4);
-- items created by imports, integrations and sample data carry only `type`: classify them from it
CREATE OR REPLACE FUNCTION products_classify() RETURNS trigger AS $$
BEGIN
  IF NOT NEW.classed THEN
    NEW.sale_class := CASE WHEN NEW.type = 'SERVICE' THEN 'SERVICE' ELSE 'STOCK' END;
    NEW.buy_roles := CASE WHEN NEW.type = 'SERVICE' THEN ARRAY['SERVICE'] ELSE ARRAY['STOCK'] END;
    NEW.classed := true;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS products_classify_trg ON products;
CREATE TRIGGER products_classify_trg BEFORE INSERT ON products FOR EACH ROW EXECUTE FUNCTION products_classify();
