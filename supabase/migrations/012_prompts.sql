-- TasteTrainer migration 012. Run once in the Supabase SQL editor (Curiosity
-- project). Safe to re-run — every statement is idempotent.
--
-- The prompts Claude works from — the curation rulebook and the saved `/` commands —
-- used to be files baked into the server image, so changing one meant a deploy, and
-- Claude could not propose a change to its own standard the way it proposes a change
-- to the data. Now a row here OVERRIDES the file of the same name (services/
-- promptStore.ts): no row, and the shipped file is what runs, exactly as before.
--
-- Written only through an accepted changeset (`prompt.update` ops) — the same gate
-- as every other write Claude makes — and only ever by the service role.

CREATE TABLE IF NOT EXISTS taste_prompts (
  name        text PRIMARY KEY,                 -- 'rules', or a command name ('gaps')
  kind        text NOT NULL,                    -- 'rules' | 'command'
  description text NOT NULL DEFAULT '',         -- commands: what the `/` picker shows
  body        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE taste_prompts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON taste_prompts TO service_role;
