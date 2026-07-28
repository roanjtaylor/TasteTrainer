-- TasteTrainer tables.
-- Run this once in the Supabase SQL editor (Curiosity project).
-- If run via the management API, also grant privileges:
--   GRANT SELECT, INSERT, UPDATE, DELETE ON taste_datasets, taste_comparison_results TO service_role;

CREATE TABLE IF NOT EXISTS taste_datasets (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS taste_comparison_results (
  dataset_id text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);
