-- TasteTrainer migration 010. Per-topic privacy for the personal world
-- (shared/types.ts#Dataset.private, 9-personal-and-auth.md).
--
-- Previously the whole `personal` domain sat behind the auth wall. Now a personal
-- dataset is public by default (same as physical/digital) and only requires sign-in
-- to view when this flag is explicitly set — e.g. family photos, but not Tweets/
-- Books/Films. Follows the generated-column pattern from migration 007: derived
-- from `data` at write time, so it can't drift from what was actually saved.

ALTER TABLE taste_datasets
  ADD COLUMN private boolean GENERATED ALWAYS AS (
    COALESCE((data->>'private')::boolean, false)
  ) STORED;
