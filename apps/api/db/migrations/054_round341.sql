-- 3.41.0: sample recurring templates are flagged, so removing the sample data leaves the establishment's own templates alone
ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
