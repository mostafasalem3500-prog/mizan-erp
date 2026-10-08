-- Round 14: product image versioning (images served from a cacheable media URL instead of inline base64 in lists)
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_updated_at timestamptz;
UPDATE products SET image_updated_at = now() WHERE image IS NOT NULL AND image_updated_at IS NULL;
