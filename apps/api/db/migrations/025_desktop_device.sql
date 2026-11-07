-- Desktop edition: serial keys bound to one device (machine fingerprint shown in the app).
ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS device_id text;   -- MZD keys: the PC the key was issued for
ALTER TABLE license_keys ADD COLUMN IF NOT EXISTS desktop boolean NOT NULL DEFAULT false; -- cloud copy of an issued desktop key (record only)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS licensed_device text; -- desktop: the device this company's licence is bound to
