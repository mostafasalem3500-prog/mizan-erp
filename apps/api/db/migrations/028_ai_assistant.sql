-- AI accounting assistant (top plan): conversations, the plan waiting for the user's confirmation, per-company settings.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ai jsonb NOT NULL DEFAULT '{}'::jsonb;   -- { apiKey?, addon? }
CREATE TABLE IF NOT EXISTS ai_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  user_name   text,
  title       text NOT NULL DEFAULT 'محادثة جديدة',
  messages    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- model history (files kept as references)
  view        jsonb NOT NULL DEFAULT '[]'::jsonb,   -- what the user sees: texts, plans, results
  pending     jsonb,                                -- proposed actions awaiting confirmation
  user_turns  int NOT NULL DEFAULT 0,
  tokens_in   bigint NOT NULL DEFAULT 0,
  tokens_out  bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_conv_idx ON ai_conversations(company_id, user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS ai_usage (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  month      text NOT NULL,                         -- YYYY-MM
  turns      int NOT NULL DEFAULT 0,
  tokens_in  bigint NOT NULL DEFAULT 0,
  tokens_out bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, month)
);
