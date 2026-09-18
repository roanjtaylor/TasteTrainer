-- TasteTrainer migration 007. Folds taste_dataset_summaries (a VIEW computed from
-- taste_datasets.data) into taste_datasets itself, as STORED GENERATED columns.
--
-- A generated column is not repeated data: Postgres derives and stores it from `data`
-- at write time and keeps it in lockstep automatically, so there's no way for a
-- summary field to drift from the dataset it describes — the failure mode a plain
-- denormalised copy would have. Doing this as columns on the source table (rather
-- than a same-schema view) also fixes a latent bug the view had: its domain CASE
-- predates the 'personal' domain (migration 005) and silently mapped personal
-- datasets to 'physical' in the shelf list.
--
-- listDatasets() (server/src/storage.ts) now selects these columns directly off
-- taste_datasets instead of querying the view — same cost (a few scalars per row,
-- not the whole jsonb blob), one fewer schema object.

ALTER TABLE taste_datasets
  ADD COLUMN domain text GENERATED ALWAYS AS (
    CASE COALESCE(data->>'domain', 'physical')
      WHEN 'hardware'  THEN 'physical'
      WHEN 'software'  THEN 'digital'
      WHEN 'digital'   THEN 'digital'
      WHEN 'personal'  THEN 'personal'
      ELSE 'physical'
    END
  ) STORED,
  ADD COLUMN topic text GENERATED ALWAYS AS (data->>'topic') STORED,
  ADD COLUMN description text GENERATED ALWAYS AS (data->>'description') STORED,
  ADD COLUMN item_count int GENERATED ALWAYS AS (
    COALESCE(jsonb_array_length(data->'items'), 0)
  ) STORED,
  ADD COLUMN subtopic_count int GENERATED ALWAYS AS (
    COALESCE(jsonb_array_length(data->'subtopics'), 0)
  ) STORED;

CREATE INDEX IF NOT EXISTS taste_datasets_domain_updated_idx
  ON taste_datasets (domain, updated_at DESC);

DROP VIEW IF EXISTS taste_dataset_summaries;
