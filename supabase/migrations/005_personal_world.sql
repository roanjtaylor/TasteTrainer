-- TasteTrainer migration 005 (2026-09-17). Run once in the Supabase SQL editor
-- (Curiosity project). Safe to re-run — every statement is idempotent.
--
-- One change: the shelf view learns the third world (9-personal-and-auth.md).
--
-- `taste_dataset_summaries` (migration 002) normalises the domain tag with a CASE
-- whose ELSE is 'physical' — right when physical was the only thing an unknown value
-- could have meant, wrong now: a 'personal' dataset would be listed on the PHYSICAL
-- shelf and be missing from its own. Until this runs, that is exactly what happens.
--
-- Nothing else needs SQL:
--   • Authentication uses Supabase Auth's own tables; no schema of ours.
--   • The private file bucket ('taste-personal') is created by the server on first
--     upload (server/src/services/personalFiles.ts), the same way the screenshot
--     bucket is. It deliberately has NO storage policies: with none, only the
--     service-role key can touch it, and browsers only ever see signed URLs.

CREATE OR REPLACE VIEW taste_dataset_summaries AS
SELECT
  d.id,
  CASE COALESCE(d.data->>'domain', 'physical')
    WHEN 'hardware' THEN 'physical'
    WHEN 'software' THEN 'digital'
    WHEN 'digital'  THEN 'digital'
    WHEN 'personal' THEN 'personal'
    ELSE 'physical'
  END                                                      AS domain,
  d.data->>'topic'                                         AS topic,
  d.data->>'description'                                   AS description,
  COALESCE(jsonb_array_length(d.data->'items'), 0)         AS item_count,
  COALESCE(jsonb_array_length(d.data->'subtopics'), 0)     AS subtopic_count,
  COALESCE(d.data->>'updatedAt', d.updated_at::text)       AS updated_at
FROM taste_datasets d;

GRANT SELECT ON taste_dataset_summaries TO service_role;
