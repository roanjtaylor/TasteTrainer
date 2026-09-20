-- TasteTrainer migration 009. Run once in the Supabase SQL editor (Curiosity
-- project). Safe to re-run — every statement is idempotent.
--
-- Durable storage for visitor-submitted item reports: flipping a picture in the
-- public /embed widget and leaving a freeform note about something wrong with it
-- (bad picture, wrong year, wrong name, ...). Never written for the personal domain
-- — embed.ts 404s that dataset id before a report could ever name one.
--
-- Flat columns, not a jsonb blob (unlike taste_datasets/taste_chat_threads): every
-- field here is something a list view or the agent's get_item_reports tool filters
-- or sorts on, and there's nothing else to carry.

CREATE TABLE IF NOT EXISTS taste_item_reports (
  id          text PRIMARY KEY,
  dataset_id  text NOT NULL,
  item_id     text NOT NULL,
  item_name   text NOT NULL DEFAULT '',
  domain      text NOT NULL,
  text        text NOT NULL,
  status      text NOT NULL DEFAULT 'open',  -- 'open' | 'resolved'
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS taste_item_reports_dataset_status_idx
  ON taste_item_reports (dataset_id, status);

-- Locked down like every other table here: RLS on, no policies, so only the
-- service-role key (which bypasses RLS entirely) can touch it — the web client never
-- holds Supabase credentials, only this server does.
ALTER TABLE taste_item_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON taste_item_reports TO service_role;
