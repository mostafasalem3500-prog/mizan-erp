-- demo dataset now includes cost centres and projects: flag them so they are removed with the rest of the demo data
ALTER TABLE cost_centers ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
