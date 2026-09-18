import { supabase } from './supabase.ts';
import { now } from './util.ts';
import { removeFiles, storagePathsIn, toServedImages, toStoredImages } from './services/personalFiles.ts';
import { cached, invalidate, invalidatePrefix, keys, put } from './cache.ts';
import { normalizeDomain, singleWordTopic, slugifyTopic } from '../../shared/types.ts';
import type { Dataset, DatasetSummary, Domain, Job, WorldMap } from '../../shared/types.ts';

/**
 * "That table isn't there" — i.e. a migration hasn't been applied yet.
 *
 * Two codes, because the answer depends on how far the request got. Postgres raises
 * `42P01` when a statement reaches it naming an unknown relation; PostgREST returns
 * `PGRST205` earlier than that, when the table is absent from its own schema cache
 * and it never builds a statement at all. Matching only the Postgres code meant the
 * common case — a table that has genuinely never been created — fell through as a raw
 * "not found in the schema cache" error instead of the message naming the migration
 * file to run.
 */
const MISSING_RELATION = new Set(['42P01', 'PGRST205']);

function missingRelation(error: { code?: string } | null): boolean {
  return !!error?.code && MISSING_RELATION.has(error.code);
}

// Domains were renamed hardware/software -> physical/digital (shared/types.ts), and
// datasets older still carry no domain at all. Both are coerced on read, so the app
// is correct whether or not migration 002 has been run against this database.
function withDomain(ds: Dataset): Dataset {
  const domain = normalizeDomain(ds.domain);
  return ds.domain === domain ? ds : { ...ds, domain };
}

// ---- Datasets ----

/**
 * The shelf listing. Reads the `taste_dataset_summaries` view (migration 002), which
 * projects out just the handful of fields a shelf card shows and filters by domain in
 * Postgres — instead of downloading every dataset's full item list to count it in JS.
 *
 * The pre-002 whole-blob fallback was removed once 002 was applied everywhere: a
 * missing view now surfaces as a real error instead of silently degrading.
 */
export async function listDatasets(domain?: Domain): Promise<DatasetSummary[]> {
  return cached(keys.datasetList(domain), async () => {
    let query = supabase
      .from('taste_dataset_summaries')
      .select('id, domain, topic, description, item_count, subtopic_count, updated_at')
      .order('updated_at', { ascending: false });
    if (domain) query = query.eq('domain', domain);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
      id: row.id,
      domain: normalizeDomain(row.domain),
      topic: row.topic ?? '',
      description: row.description ?? '',
      itemCount: row.item_count ?? 0,
      subtopicCount: row.subtopic_count ?? 0,
      updatedAt: row.updated_at ?? '',
    }));
  });
}

/**
 * One dataset, addressed by either its id or its slug — the web app's URLs are
 * /physical/ships, so the slug is what arrives on a deep link or a refresh, while
 * older links (and the app's own writes) still carry the id.
 *
 * Id first: it's the primary key, so the common case is one indexed lookup and the
 * slug query only runs for a name-shaped address.
 */
export async function getDataset(idOrSlug: string): Promise<Dataset | null> {
  return cached(keys.dataset(idOrSlug), async () => {
    const byId = await readDatasetBy('id', idOrSlug);
    return byId ?? (await readDatasetBy('slug', idOrSlug));
  });
}

async function readDatasetBy(column: 'id' | 'slug', value: string): Promise<Dataset | null> {
  const { data, error } = await supabase
    .from('taste_datasets')
    .select('data')
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Private files are stored as permanent references and served as signed links
  // (services/personalFiles.ts). Converting here — the one read path — is what lets
  // every caller downstream, comparison routes included, treat `image` as a URL.
  return data?.data ? toServedImages(withDomain(data.data as Dataset)) : null;
}

/**
 * Write a dataset back. `previousSlug` is the slug it was reachable at *before* this
 * save — pass it on a rename so the old address stops serving the old name from cache
 * (a renamed dataset's link changes, and the stale entry would outlive the rename).
 */
export async function saveDataset(input: Dataset, previousSlug?: string): Promise<Dataset> {
  input.updatedAt = now();
  input.domain = normalizeDomain(input.domain);
  input.topic = singleWordTopic(input.topic);
  const slug = slugifyTopic(input.topic);
  // The mirror of readDatasetBy: the client sends back the signed links it was served,
  // and a signed link must never reach the database — it expires.
  const stored = toStoredImages(input);
  const { error } = await supabase
    .from('taste_datasets')
    .upsert({ id: stored.id, slug, data: stored, updated_at: stored.updatedAt });
  if (error) throw new Error(error.message);
  if (previousSlug && previousSlug !== slug) invalidate(keys.dataset(previousSlug));
  const ds = await toServedImages(stored);
  // Seed rather than clear: the client almost always re-reads what it just wrote.
  // Both addresses, since either may be the one it reads back through.
  put(keys.dataset(ds.id), ds);
  put(keys.dataset(slug), ds);
  invalidatePrefix(keys.datasetListPrefix);
  return ds;
}

export async function deleteDataset(id: string, slug?: string): Promise<void> {
  // Read before the row goes: once it's deleted nothing records which files were its.
  const doomed = await getDataset(id);

  const { error } = await supabase.from('taste_datasets').delete().eq('id', id);
  if (error) throw new Error(error.message);
  if (doomed) await removeFiles(storagePathsIn(doomed));

  invalidate(keys.dataset(id));
  if (slug) invalidate(keys.dataset(slug));
  invalidatePrefix(keys.datasetListPrefix);
}

// ---- World maps (one row per domain) ----

const MAP_MIGRATION_HINT =
  'The taste_world_maps table is missing. Run supabase/migrations/003_world_maps.sql in the Supabase SQL editor.';

/**
 * One world's stored map, or null if it has never been reviewed.
 *
 * Null is a normal state, not an error: a world with no map yet renders as the plain
 * grid with a prompt to run the review. A *missing table*, by contrast, is a real
 * configuration problem — so it throws with the migration named rather than
 * pretending the map simply doesn't exist yet.
 */
export async function getWorldMap(domain: Domain): Promise<WorldMap | null> {
  return cached(keys.worldMap(domain), async () => {
    const { data, error } = await supabase
      .from('taste_world_maps')
      .select('data')
      .eq('domain', domain)
      .maybeSingle();
    if (missingRelation(error)) throw new Error(MAP_MIGRATION_HINT);
    if (error) throw new Error(error.message);
    return (data?.data as WorldMap) ?? null;
  });
}

export async function saveWorldMap(map: WorldMap): Promise<WorldMap> {
  map.updatedAt = now();
  const { error } = await supabase
    .from('taste_world_maps')
    .upsert({ domain: map.domain, data: map, updated_at: map.updatedAt });
  if (missingRelation(error)) throw new Error(MAP_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  // Seed rather than clear: dragging a card writes and then immediately re-reads.
  put(keys.worldMap(map.domain), map);
  return map;
}

// ---- Background jobs (one row per long curation call — see shared/types.ts) ----
//
// Not cached: a job's whole point is to be read fresh (its status changes while it's
// being watched), and job traffic is low-volume enough that a Supabase round trip on
// every read is not worth the staleness risk a TTL cache would introduce here.

const JOBS_MIGRATION_HINT =
  'The taste_jobs table is missing. Run supabase/migrations/004_jobs.sql in the Supabase SQL editor.';

/** A `running` job whose row hasn't been touched in this long is presumed dead — most
 *  likely a server restart interrupted it mid-call — rather than shown as spinning
 *  forever. Computed at read time, not written back: there is no background sweep, so
 *  a job that outlives this window simply reads as failed from then on. */
const STALE_RUNNING_MS = 20 * 60_000;

function rowToJob(row: any): Job {
  const job: Job = { id: row.id, domain: normalizeDomain(row.domain), status: row.status, ...row.data };
  if (job.status === 'running' && Date.now() - new Date(job.updatedAt).getTime() > STALE_RUNNING_MS) {
    return { ...job, status: 'error', error: 'No update in over 20 minutes — probably interrupted by a restart.' };
  }
  return job;
}

export async function createJob(job: Job): Promise<Job> {
  const { id, domain, status, ...data } = job;
  const { error } = await supabase
    .from('taste_jobs')
    .insert({ id, domain, status, data, updated_at: job.updatedAt });
  if (missingRelation(error)) throw new Error(JOBS_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return job;
}

/** Merge `patch` into a job's stored `data` and bump `status`/`updated_at`. A no-op,
 *  not an error, if the row is already gone — the job's owner dismissed it on
 *  purpose, and the call producing this update has no way to know that, or need to. */
export async function updateJob(
  id: string,
  patch: Partial<Pick<Job, 'status' | 'progress' | 'result' | 'error'>>,
): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from('taste_jobs')
    .select('data, status')
    .eq('id', id)
    .maybeSingle();
  if (missingRelation(readErr)) throw new Error(JOBS_MIGRATION_HINT);
  if (readErr) throw new Error(readErr.message);
  if (!row) return;

  const nextStatus = patch.status ?? row.status;
  const nextData = { ...row.data, ...patch, updatedAt: now() };
  delete (nextData as any).status;
  const { error } = await supabase
    .from('taste_jobs')
    .update({ status: nextStatus, data: nextData, updated_at: nextData.updatedAt })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function getJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase.from('taste_jobs').select('*').eq('id', id).maybeSingle();
  if (missingRelation(error)) throw new Error(JOBS_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return data ? rowToJob(data) : null;
}

/** Every job, or one domain's — unscoped so a global "N waiting" indicator can query
 *  both worlds in a single call. Newest first, same convention as `listDatasets`. */
export async function listJobs(domain?: Domain): Promise<Job[]> {
  let query = supabase.from('taste_jobs').select('*').order('updated_at', { ascending: false });
  if (domain) query = query.eq('domain', domain);
  const { data, error } = await query;
  if (missingRelation(error)) return [];
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToJob);
}

export async function deleteJob(id: string): Promise<void> {
  const { error } = await supabase.from('taste_jobs').delete().eq('id', id);
  if (missingRelation(error)) return;
  if (error) throw new Error(error.message);
}
