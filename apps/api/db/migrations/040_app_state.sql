-- installation-level state (desktop protection): the latest time ever seen, and the first run of this installation
CREATE TABLE IF NOT EXISTS app_state (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
