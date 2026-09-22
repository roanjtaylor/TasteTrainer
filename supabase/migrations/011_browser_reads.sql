-- TasteTrainer migration 011. Run once in the Supabase SQL editor (Curiosity
-- project). Safe to re-run — every statement is idempotent.
--
-- Reads (and the two small visitor/curator writes) move from the Render server to the
-- browser, straight against Supabase (web/src/lib/db.ts). The server keeps only what
-- genuinely needs a server: the Claude agent, image sourcing, tweet import, uploads.
-- Until now every taste_* table had RLS on with NO policies, so the browser's
-- publishable key could read nothing and every page view woke the Render free tier
-- (15-minute spin-down, ~1 minute cold start). These policies are the exact rules
-- server/src/routes/{datasets,embed,reports,map}.ts used to apply per request.
--
-- The curator allowlist lives here now (it was ALLOWED_EMAILS, a server env var —
-- keep both in step). Empty means "any signed-in account", mirroring the server's
-- warning-but-allow behaviour; new sign-ups are disabled at the project level.

CREATE TABLE IF NOT EXISTS taste_curators (
  email text PRIMARY KEY
);
ALTER TABLE taste_curators ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON taste_curators TO service_role;
-- INSERT INTO taste_curators (email) VALUES ('you@example.com') ON CONFLICT DO NOTHING;

-- SECURITY DEFINER so the policies below can consult the allowlist without the
-- allowlist itself being readable to anyone.
CREATE OR REPLACE FUNCTION taste_is_curator() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.role() = 'authenticated' AND (
    NOT EXISTS (SELECT 1 FROM taste_curators)
    OR EXISTS (
      SELECT 1 FROM taste_curators
      WHERE email = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );
$$;
REVOKE ALL ON FUNCTION taste_is_curator() FROM public;
GRANT EXECUTE ON FUNCTION taste_is_curator() TO anon, authenticated;

-- Datasets: everything is readable except a personal topic explicitly marked private,
-- which only the curator sees (migration 010's generated `private` column). Writes
-- stay with the service role — the agent and the app's remaining API routes.
GRANT SELECT ON taste_datasets TO anon, authenticated;
DROP POLICY IF EXISTS taste_datasets_read ON taste_datasets;
CREATE POLICY taste_datasets_read ON taste_datasets
  FOR SELECT TO anon, authenticated
  USING (NOT private OR taste_is_curator());

-- World maps: public, read-only. Changed only by accepting a changeset the agent staged.
GRANT SELECT ON taste_world_maps TO anon, authenticated;
DROP POLICY IF EXISTS taste_world_maps_read ON taste_world_maps;
CREATE POLICY taste_world_maps_read ON taste_world_maps
  FOR SELECT TO anon, authenticated
  USING (true);

-- Item reports: any visitor may file one (the embed widget's card back), with the same
-- limits routes/embed.ts enforced — a short note, on an item of a dataset they can
-- see, always opened as 'open'. Only the curator reads, resolves or deletes them.
GRANT SELECT, INSERT, UPDATE, DELETE ON taste_item_reports TO anon, authenticated;
DROP POLICY IF EXISTS taste_item_reports_file ON taste_item_reports;
CREATE POLICY taste_item_reports_file ON taste_item_reports
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'open'
    AND length(text) BETWEEN 1 AND 2000
    AND length(item_name) <= 500
    AND EXISTS (
      SELECT 1 FROM taste_datasets d
      WHERE d.id = dataset_id
        AND d.domain = taste_item_reports.domain
        AND NOT d.private
        AND d.data -> 'items' @> jsonb_build_array(jsonb_build_object('id', item_id))
    )
  );
DROP POLICY IF EXISTS taste_item_reports_curate ON taste_item_reports;
CREATE POLICY taste_item_reports_curate ON taste_item_reports
  FOR ALL TO authenticated
  USING (taste_is_curator())
  WITH CHECK (taste_is_curator());

-- Private uploads (services/personalFiles.ts): the browser now signs its own links
-- to them, which Storage only allows for objects the caller may SELECT. The bucket is
-- created by the server on first upload, so this may predate it — that's fine.
DROP POLICY IF EXISTS taste_personal_read ON storage.objects;
CREATE POLICY taste_personal_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'taste-personal' AND taste_is_curator());
