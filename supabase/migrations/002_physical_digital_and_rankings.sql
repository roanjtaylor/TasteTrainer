-- TasteTrainer migration 002 (2026-07-28). Run once in the Supabase SQL editor
-- (Curiosity project). Safe to re-run — every statement is idempotent.
--
-- Three changes:
--   1. Domains renamed 'hardware'/'software' -> 'physical'/'digital'.
--   2. A summary VIEW so the datasets shelf stops downloading every dataset in full.
--   3. Per-person rankings, so each name gets its own leaderboard for a dataset.

-- ---------------------------------------------------------------------------
-- 1. Rename the domain tag on every stored dataset.
--    (The server also normalises on read, so the app works before this runs —
--    this just makes the stored rows say what they mean.)
-- ---------------------------------------------------------------------------
UPDATE taste_datasets
   SET data = jsonb_set(data, '{domain}', '"physical"'::jsonb, true)
 WHERE data->>'domain' IS DISTINCT FROM 'software'
   AND COALESCE(data->>'domain', '') <> 'physical'
   AND COALESCE(data->>'domain', '') <> 'digital';

UPDATE taste_datasets
   SET data = jsonb_set(data, '{domain}', '"digital"'::jsonb, true)
 WHERE data->>'domain' = 'software';

-- ---------------------------------------------------------------------------
-- 2. Shelf summaries.
--    The home shelf only needs a topic, a description and two counts, but the
--    old query selected the whole `data` blob for every dataset and filtered in
--    JS — pulling every item, description and image URL in the account on each
--    page load. This view does that work in Postgres so the wire payload is a
--    few hundred bytes per dataset instead of tens of kilobytes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW taste_dataset_summaries AS
SELECT
  d.id,
  CASE COALESCE(d.data->>'domain', 'physical')
    WHEN 'hardware' THEN 'physical'
    WHEN 'software' THEN 'digital'
    WHEN 'digital'  THEN 'digital'
    ELSE 'physical'
  END                                                      AS domain,
  d.data->>'topic'                                         AS topic,
  d.data->>'description'                                   AS description,
  COALESCE(jsonb_array_length(d.data->'items'), 0)         AS item_count,
  COALESCE(jsonb_array_length(d.data->'subtopics'), 0)     AS subtopic_count,
  COALESCE(d.data->>'updatedAt', d.updated_at::text)       AS updated_at
FROM taste_datasets d;

-- ---------------------------------------------------------------------------
-- 3. Per-person rankings.
--    One row per (dataset, person) rather than one blob per dataset, so a vote
--    reads and writes only that person's scores — adding people costs nothing
--    in read/write size, which a single shared blob would not have managed.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taste_rankings (
  dataset_id  text NOT NULL,
  ranker_key  text NOT NULL,   -- normalised name (lowercase, collapsed spaces)
  ranker_name text NOT NULL,   -- as first typed, for display
  data        jsonb NOT NULL,  -- a ResultsFile
  updated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (dataset_id, ranker_key)
);

CREATE INDEX IF NOT EXISTS taste_rankings_dataset_idx ON taste_rankings (dataset_id);

-- Name plates without the scores. The list of who has ranked a dataset is read on
-- every visit to the leaderboard; this keeps that read to a few bytes per person
-- instead of shipping everybody's full ratings map just to count it.
CREATE OR REPLACE VIEW taste_ranker_summaries AS
SELECT
  r.dataset_id,
  r.ranker_key,
  r.ranker_name,
  COALESCE((r.data->>'comparisons')::int, 0)                                AS comparisons,
  (SELECT count(*) FROM jsonb_object_keys(COALESCE(r.data->'ratings', '{}'::jsonb))) AS items_judged,
  COALESCE(r.data->>'updatedAt', r.updated_at::text)                        AS updated_at
FROM taste_rankings r;

-- Carry the pre-rankings results across so no existing ranking work is lost.
-- They were recorded before names existed, hence the neutral "Original" plate.
INSERT INTO taste_rankings (dataset_id, ranker_key, ranker_name, data, updated_at)
SELECT
  r.dataset_id,
  'original',
  'Original',
  jsonb_set(r.data, '{ranker}', '{"key":"original","name":"Original"}'::jsonb, true),
  r.updated_at
FROM taste_comparison_results r
ON CONFLICT (dataset_id, ranker_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Privileges (needed when this is applied via the management API rather than
-- the dashboard SQL editor, matching the note in 001).
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON taste_rankings TO service_role;
GRANT SELECT ON taste_dataset_summaries TO service_role;
GRANT SELECT ON taste_ranker_summaries TO service_role;
