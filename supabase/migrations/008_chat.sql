-- TasteTrainer migration 008. Run once in the Supabase SQL editor (Curiosity
-- project). Safe to re-run — every statement is idempotent.
--
-- The Claude chat (plan/claude-agent.md, shared/chat.ts). Two tables:
--
--   taste_chat_threads — one row per conversation. `data` is the whole thread: title
--     and every message, each assistant turn with its blocks (thinking, text, tool
--     calls) exactly as they streamed. Written in batches while a turn runs, so a turn
--     survives the browser closing and can be re-read from any device.
--
--   taste_changesets — the edits Claude has STAGED in a thread, awaiting approval. One
--     row per changeset; `data` holds the ops, each with its before/after, and — once
--     applied — the undo records that put it back. Nothing in here has touched
--     taste_datasets until its op's status reads 'applied'.
--
-- `domain` and `status` are flattened out of `data` because they're filtered on.

CREATE TABLE IF NOT EXISTS taste_chat_threads (
  id         text PRIMARY KEY,
  domain     text,                 -- world the thread started in; NULL = the gate
  data       jsonb NOT NULL,       -- { title, messages, createdAt, updatedAt }
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS taste_chat_threads_updated_idx ON taste_chat_threads (updated_at DESC);

CREATE TABLE IF NOT EXISTS taste_changesets (
  id         text PRIMARY KEY,
  thread_id  text NOT NULL,
  status     text NOT NULL DEFAULT 'open',  -- 'open' | 'applied' | 'discarded' | 'reverted'
  data       jsonb NOT NULL,       -- { ops, datasetTopics, undo, createdAt, updatedAt }
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS taste_changesets_thread_idx ON taste_changesets (thread_id, status);

-- Locked down like every other table here: RLS on, no policies, so only the
-- service-role key can touch them.
ALTER TABLE taste_chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE taste_changesets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON taste_chat_threads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON taste_changesets TO service_role;
