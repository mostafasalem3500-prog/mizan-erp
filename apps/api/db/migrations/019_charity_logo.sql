-- Round 21: association logo (own column, separate from the accounting company logo) and the official short name
ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS logo text;
UPDATE charity_settings SET association_name = 'جمعية ريادة العطاء لخدمة الإنسان بالعسيلة', updated_at = now()
WHERE association_name IS NULL OR association_name = '' OR association_name = 'جمعية ريادة العطاء لخدمة الإنسان بالعسيلة الأهلية';
-- the old default green palette gives way to the logo's navy/blue (custom colours are kept)
UPDATE charity_settings SET theme = theme - 'color' WHERE lower(theme->>'color') = '#1f6f4a';
UPDATE charity_settings SET theme = theme - 'accent' WHERE lower(theme->>'accent') = '#b7862b';
