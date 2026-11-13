-- One expense shared between several cost centres / projects: the net amount of each share (the rest is general).
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS allocations jsonb;
