-- 3.46.0: sample modifier groups are flagged so removing the sample data removes them
ALTER TABLE modifier_groups ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
