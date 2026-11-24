-- 3.44.0: waste (yield loss) per recipe ingredient
ALTER TABLE product_recipes ADD COLUMN IF NOT EXISTS waste_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (waste_pct >= 0 AND waste_pct <= 90);
