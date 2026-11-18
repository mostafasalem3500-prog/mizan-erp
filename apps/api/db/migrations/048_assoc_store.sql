-- Associations: Salla donation store (orders become donation receipts), public verification of donation receipts,
-- board decision on large expense runs

ALTER TABLE salla_connections ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'SALES';          -- SALES | DONATIONS
ALTER TABLE salla_connections ADD COLUMN IF NOT EXISTS donation_map jsonb NOT NULL DEFAULT '{}'::jsonb; -- {defaultSource, defaultProjectId, rules:[{match, projectId, source}]}

ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS external_ref text;
CREATE INDEX IF NOT EXISTS ch_rcpt_ext_idx ON charity_receipts(company_id, external_ref) WHERE external_ref IS NOT NULL;
ALTER TABLE charity_receipts ADD COLUMN IF NOT EXISTS verify_token text;
CREATE UNIQUE INDEX IF NOT EXISTS ch_rcpt_verify_idx ON charity_receipts(verify_token) WHERE verify_token IS NOT NULL;
UPDATE charity_receipts SET verify_token = replace(replace(encode(gen_random_bytes(12), 'base64'), '/', '_'), '+', '-') WHERE verify_token IS NULL;

ALTER TABLE charity_batches ADD COLUMN IF NOT EXISTS decision_id uuid;

-- fix: 046 meant to add an `authority` jsonb column for the authority matrix, but charity_settings already had
-- `authority` (text: the supervising body's name), so the matrix was written over that name and never read back.
-- The matrix moves to its own column; a saved matrix found in the text column is moved there and the name cleared.
ALTER TABLE charity_settings ADD COLUMN IF NOT EXISTS authority_matrix jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE charity_settings SET authority_matrix = authority::jsonb, authority = NULL
 WHERE authority LIKE '{%"levels"%}' AND authority_matrix = '{}'::jsonb;
