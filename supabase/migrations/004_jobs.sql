-- TasteTrainer migration 004. Run once in the Supabase SQL editor (Curiosity
-- project). Safe to re-run — every statement is idempotent.
--
-- One change: durable storage for long curation calls (item generation, gap-fill
-- research), so a call already running on the persistent server process survives the
-- browser closing before it can persist the result itself.
--
-- One row per call. `data` carries everything that doesn't need to be queried on:
-- kind ('items' | 'gap-fill'), a human title, the exact request body the call was
-- started with (input), the latest progress line, and — once finished — the result
-- payload or an error message. `status` is flattened out into its own column because
-- the resume banner filters on it directly.

CREATE TABLE IF NOT EXISTS taste_jobs (
  id         text PRIMARY KEY,
  domain     text NOT NULL,        -- 'physical' | 'digital'
  status     text NOT NULL DEFAULT 'running',  -- 'running' | 'done' | 'error'
  data       jsonb NOT NULL,       -- { kind, title, input, progress, result, error }
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS taste_jobs_domain_status_idx ON taste_jobs (domain, status);

-- Locked down like every other table here: RLS on, no policies, so only the
-- service-role key (which bypasses RLS entirely) can touch it — the web client never
-- holds Supabase credentials, only this server does.
ALTER TABLE taste_jobs ENABLE ROW LEVEL SECURITY;

-- Privileges (needed when this is applied via the management API rather than the
-- dashboard SQL editor, matching the note in 001-003).
GRANT SELECT, INSERT, UPDATE, DELETE ON taste_jobs TO service_role;
