-- Round 11: branch-restricted members + ZATCA developer-portal self-test results
ALTER TABLE memberships ADD COLUMN IF NOT EXISTS restrict_branch boolean NOT NULL DEFAULT false;
ALTER TABLE zatca_configs ADD COLUMN IF NOT EXISTS selftest jsonb;
ALTER TABLE zatca_configs ADD COLUMN IF NOT EXISTS selftest_at timestamptz;
