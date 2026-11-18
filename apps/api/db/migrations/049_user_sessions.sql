-- 3.37.0: sign-in sessions — listed on «my account», ended from another device, ended on password change
CREATE TABLE IF NOT EXISTS user_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '12 hours',
  revoked_at    timestamptz,
  revoked_reason text
);
CREATE INDEX IF NOT EXISTS user_sessions_user ON user_sessions(user_id, expires_at DESC);
