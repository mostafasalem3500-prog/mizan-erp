-- two-step sign-in (TOTP, RFC 6238): the shared secret, whether it is on, and hashed one-time recovery codes
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_recovery jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;
