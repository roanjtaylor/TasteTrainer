import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.ts';
import { now } from './util.ts';
import { cached, invalidate, invalidatePrefix, keys, put } from './cache.ts';
import { normalizeDomain, rankerKeyOf, slugifyTopic } from '../../shared/types.ts';
import type {
  Dataset,
  DatasetSummary,
  Domain,
  Ranker,
  RankerSummary,
  ResultsFile,
} from '../../shared/types.ts';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/** Postgres "relation does not exist" — i.e. a migration hasn't been applied yet. */
const MISSING_RELATION = '42P01';

function missingRelation(error: { code?: string } | null): boolean {
  return error?.code === MISSING_RELATION;
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
 * Falls back to that original whole-blob query if the view isn't there yet, so the app
 * keeps working on a database where 002 hasn't been applied; it's just slower.
 */
export async function listDatasets(domain?: Domain): Promise<DatasetSummary[]> {
  return cached(keys.datasetList(domain), async () => {
    let query = supabase
      .from('taste_dataset_summaries')
      .select('id, domain, topic, description, item_count, subtopic_count, updated_at')
      .order('updated_at', { ascending: false });
    if (domain) query = query.eq('domain', domain);

    const { data, error } = await query;
    if (missingRelation(error)) return listDatasetsFallback(domain);
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

/** Pre-002 path: pull every dataset whole and summarise in JS. Correct, but heavy —
 *  logged once per cache miss so it's obvious the migration is still outstanding. */
async function listDatasetsFallback(domain?: Domain): Promise<DatasetSummary[]> {
  console.warn(
    '[storage] taste_dataset_summaries view not found — falling back to full-row reads. ' +
      'Apply supabase/migrations/002_physical_digital_and_rankings.sql to cut this payload.',
  );
  const { data, error } = await supabase
    .from('taste_datasets')
    .select('id, data')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map(({ id, data: raw }: { id: string; data: Dataset }) => ({ id, ds: withDomain(raw) }))
    .filter(({ ds }) => !domain || ds.domain === domain)
    .map(({ id, ds }) => ({
      id,
      domain: ds.domain,
      topic: ds.topic,
      description: ds.description,
      itemCount: (ds.items ?? []).length,
      subtopicCount: (ds.subtopics ?? []).length,
      updatedAt: ds.updatedAt,
    }));
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
  return data?.data ? withDomain(data.data as Dataset) : null;
}

/**
 * Write a dataset back. `previousSlug` is the slug it was reachable at *before* this
 * save — pass it on a rename so the old address stops serving the old name from cache
 * (a renamed dataset's link changes, and the stale entry would outlive the rename).
 */
export async function saveDataset(ds: Dataset, previousSlug?: string): Promise<Dataset> {
  ds.updatedAt = now();
  ds.domain = normalizeDomain(ds.domain);
  const slug = slugifyTopic(ds.topic);
  const { error } = await supabase
    .from('taste_datasets')
    .upsert({ id: ds.id, slug, data: ds, updated_at: ds.updatedAt });
  if (error) throw new Error(error.message);
  if (previousSlug && previousSlug !== slug) invalidate(keys.dataset(previousSlug));
  // Seed rather than clear: the client almost always re-reads what it just wrote.
  // Both addresses, since either may be the one it reads back through.
  put(keys.dataset(ds.id), ds);
  put(keys.dataset(slug), ds);
  invalidatePrefix(keys.datasetListPrefix);
  return ds;
}

export async function deleteDataset(id: string, slug?: string): Promise<void> {
  // Rankings first, then the legacy single-blob results, then the dataset itself —
  // so a failure part-way never leaves scores pointing at a dataset that's gone.
  const { error: rankErr } = await supabase.from('taste_rankings').delete().eq('dataset_id', id);
  if (rankErr && !missingRelation(rankErr)) throw new Error(rankErr.message);

  const { error: resError } = await supabase
    .from('taste_comparison_results')
    .delete()
    .eq('dataset_id', id);
  if (resError) throw new Error(resError.message);

  const { error } = await supabase.from('taste_datasets').delete().eq('id', id);
  if (error) throw new Error(error.message);

  invalidate(keys.dataset(id));
  if (slug) invalidate(keys.dataset(slug));
  invalidatePrefix(keys.datasetListPrefix);
  invalidatePrefix(keys.rankersPrefix(id));
}

// ---- Rankings (one row per person, per dataset) ----
//
// Arcade model: a name owns a set of scores. Storing one row per (dataset, ranker)
// rather than one blob per dataset means a vote reads and writes only the voting
// person's ratings, so a dataset ranked by ten people costs the same per vote as one
// ranked by one — which a shared blob would not have managed.

const MIGRATION_HINT =
  'The taste_rankings table is missing. Run supabase/migrations/002_physical_digital_and_rankings.sql in the Supabase SQL editor.';

function emptyFor(datasetId: string, ranker: Ranker): ResultsFile {
  return { datasetId, ranker, ratings: {}, comparisons: 0, updatedAt: now() };
}

/** One person's ratings for a dataset. Never null — an unknown name is simply a
 *  fresh scorecard, which is exactly what "type your name and start" should mean. */
export async function getRanking(datasetId: string, ranker: Ranker): Promise<ResultsFile> {
  const key = rankerKeyOf(ranker.name) || ranker.key;
  return cached(keys.ranking(datasetId, key), async () => {
    const { data, error } = await supabase
      .from('taste_rankings')
      .select('data')
      .eq('dataset_id', datasetId)
      .eq('ranker_key', key)
      .maybeSingle();
    if (missingRelation(error)) throw new Error(MIGRATION_HINT);
    if (error) throw new Error(error.message);
    const stored = data?.data as ResultsFile | undefined;
    if (!stored) return emptyFor(datasetId, { key, name: ranker.name });
    // Trust the stored display name — it's whoever claimed the plate first.
    return { ...stored, datasetId, ranker: stored.ranker ?? { key, name: ranker.name } };
  });
}

export async function saveRanking(results: ResultsFile): Promise<ResultsFile> {
  const ranker = results.ranker;
  if (!ranker) throw new Error('A ranking must belong to a named ranker.');
  results.updatedAt = now();

  const { error } = await supabase.from('taste_rankings').upsert({
    dataset_id: results.datasetId,
    ranker_key: ranker.key,
    ranker_name: ranker.name,
    data: results,
    updated_at: results.updatedAt,
  });
  if (missingRelation(error)) throw new Error(MIGRATION_HINT);
  if (error) throw new Error(error.message);

  put(keys.ranking(results.datasetId, ranker.key), results);
  // The name list and the pooled view both change on a first-ever vote, so drop them.
  invalidate(keys.rankerList(results.datasetId));
  invalidate(keys.allRankings(results.datasetId));
  return results;
}

/** Everyone who has ranked this dataset — the cabinet's list of name plates. Reads
 *  the summaries view so the counts come back already computed, never as ratings
 *  blobs this would then have to count in JS. */
export async function listRankers(datasetId: string): Promise<RankerSummary[]> {
  return cached(keys.rankerList(datasetId), async () => {
    const { data, error } = await supabase
      .from('taste_ranker_summaries')
      .select('ranker_key, ranker_name, comparisons, items_judged, updated_at')
      .eq('dataset_id', datasetId)
      .order('comparisons', { ascending: false });
    if (missingRelation(error)) return [];
    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
      key: row.ranker_key,
      name: row.ranker_name,
      comparisons: Number(row.comparisons) || 0,
      itemsJudged: Number(row.items_judged) || 0,
      updatedAt: row.updated_at ?? '',
    }));
  });
}

/** Every person's ratings for a dataset — the input to the pooled leaderboard.
 *  Only read when the pooled view is actually being shown. */
export async function getAllRankings(datasetId: string): Promise<ResultsFile[]> {
  return cached(keys.allRankings(datasetId), async () => {
    const { data, error } = await supabase
      .from('taste_rankings')
      .select('data')
      .eq('dataset_id', datasetId);
    if (missingRelation(error)) return [];
    if (error) throw new Error(error.message);
    return (data ?? []).map((row: any) => row.data as ResultsFile).filter(Boolean);
  });
}
