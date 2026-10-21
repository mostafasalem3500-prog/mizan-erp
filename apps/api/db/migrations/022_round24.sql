-- Round 24: expense runs can be paid from the zakat fund (monthly zakat distributions)
ALTER TABLE charity_batches ADD COLUMN IF NOT EXISTS fund text NOT NULL DEFAULT 'GENERAL';
ALTER TABLE charity_batches ADD COLUMN IF NOT EXISTS zakat_category text;
