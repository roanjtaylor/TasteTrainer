import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeDomain } from '../../../shared/types';
import type { Dataset, DatasetSummary, Domain, EmbedDataset, ItemReport, WorldMap } from '../../../shared/types';
import { supabase } from './supabase';

// Reads, straight from Supabase — no server in the way.
//
// Everything a visitor looks at (the shelf, a dataset, a world's map, the embed
// widget) is a row in a table the browser can read for itself, so it does: row level
// security (supabase/migrations/011_browser_reads.sql) applies the rules the API used
// to — a private personal topic is invisible unless the curator is signed in. The
// Render server is left to the work that needs a server (the Claude agent, image
// sourcing, tweet import, uploads) and no longer has to wake from its free-tier
// spin-down just to answer a page view.
//
// The two writes here are the same shape: a visitor filing a report from the widget,
// and the curator dismissing one — each one row, each governed by a policy.

/** The private bucket's stored-reference spelling (server/src/services/personalFiles.ts).
 *  The server writes `storage://taste-personal/<path>`; the browser turns it into a
 *  signed link on read, exactly as the server used to. */
const PERSONAL_BUCKET = 'taste-personal';
const REF_PREFIX = `storage://${PERSONAL_BUCKET}/`;
const SIGNED_TTL_SECONDS = 7 * 24 * 60 * 60;

function client(): SupabaseClient {
  if (!supabase) throw new Error('Set VITE_SUPABASE_KEY to the project’s publishable key.');
  return supabase;
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? 'Request failed');
}

export async function listDatasets(domain?: Domain): Promise<DatasetSummary[]> {
  let query = client()
    .from('taste_datasets')
    .select('id, domain, topic, description, item_count, subtopic_count, updated_at, private')
    .order('updated_at', { ascending: false });
  if (domain) query = query.eq('domain', domain);
  const { data, error } = await query;
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    domain: normalizeDomain(row.domain),
    topic: row.topic ?? '',
    description: row.description ?? '',
    itemCount: row.item_count ?? 0,
    subtopicCount: row.subtopic_count ?? 0,
    updatedAt: row.updated_at ?? '',
    private: !!row.private,
  }));
}

/** By id or by slug — the URL carries the slug, the app's own links the id. Null when
 *  there's no such dataset OR it's private and nobody's signed in: RLS hides rather
 *  than refuses, so a caller that cares tells the two apart by whether it's signed in. */
export async function getDataset(idOrSlug: string): Promise<Dataset | null> {
  return (await readBy('id', idOrSlug)) ?? (await readBy('slug', idOrSlug));
}

async function readBy(column: 'id' | 'slug', value: string): Promise<Dataset | null> {
  const { data, error } = await client().from('taste_datasets').select('data').eq(column, value).maybeSingle();
  if (error) fail(error);
  if (!data?.data) return null;
  const ds = data.data as Dataset;
  return toServedImages({ ...ds, domain: normalizeDomain(ds.domain) });
}

/** Stored → served: one signing call per dataset for its private uploads. Signing
 *  needs SELECT on the objects (the storage policy in migration 011), so signed out
 *  the pictures come back blank — which only ever happens for a public personal topic
 *  that mixes uploads in, and reads as "needs image" rather than a dead link. */
async function toServedImages(ds: Dataset): Promise<Dataset> {
  const paths = [...new Set(ds.items.map((it) => storagePathOf(it.image)).filter((p): p is string => !!p))];
  if (!paths.length) return ds;
  const { data } = await client().storage.from(PERSONAL_BUCKET).createSignedUrls(paths, SIGNED_TTL_SECONDS);
  const signed = new Map<string, string>();
  for (const row of data ?? []) if (row.path && row.signedUrl) signed.set(row.path, row.signedUrl);
  return {
    ...ds,
    items: ds.items.map((it) => {
      const path = storagePathOf(it.image);
      return path ? { ...it, image: signed.get(path) ?? '' } : it;
    }),
  };
}

function storagePathOf(image: string): string | null {
  return image.startsWith(REF_PREFIX) ? image.slice(REF_PREFIX.length) : null;
}

/** The widget's view of a dataset (shared/types.ts#EmbedDataset). */
export async function getEmbed(idOrSlug: string): Promise<EmbedDataset | null> {
  const ds = await getDataset(idOrSlug);
  if (!ds) return null;
  return {
    id: ds.id,
    domain: ds.domain,
    topic: ds.topic,
    description: ds.description,
    items: ds.items.map((it) => ({
      id: it.id,
      name: it.name,
      image: it.image,
      year: it.year,
      brand: it.brand,
      description: it.description,
      definingFact: it.definingFact,
      ...(it.tweet ? { tweet: it.tweet } : {}),
    })),
  };
}

/** Null is a normal answer: a world whose map hasn't been drawn yet has none. */
export async function getWorldMap(domain: Domain): Promise<WorldMap | null> {
  const { data, error } = await client().from('taste_world_maps').select('data').eq('domain', domain).maybeSingle();
  if (error) fail(error);
  return (data?.data as WorldMap) ?? null;
}

// ---- Item reports (migration 009; the policies in 011) ----

export async function createReport(ds: Pick<EmbedDataset, 'id' | 'domain'>, item: { id: string; name: string }, text: string): Promise<void> {
  const { error } = await client().from('taste_item_reports').insert({
    id: crypto.randomUUID(),
    dataset_id: ds.id,
    item_id: item.id,
    item_name: item.name,
    domain: ds.domain,
    text,
    status: 'open',
  });
  if (error) fail(error);
}

/** Open reports on one dataset, newest first. Curator only — anyone else gets none. */
export async function listOpenReports(datasetId: string): Promise<ItemReport[]> {
  const { data, error } = await client()
    .from('taste_item_reports')
    .select('*')
    .eq('dataset_id', datasetId)
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (error) fail(error);
  return (data ?? []).map((row) => ({
    id: row.id,
    datasetId: row.dataset_id,
    itemId: row.item_id,
    itemName: row.item_name ?? '',
    domain: normalizeDomain(row.domain),
    text: row.text,
    status: row.status,
    createdAt: row.created_at,
  }));
}

export async function deleteReport(id: string): Promise<void> {
  const { error } = await client().from('taste_item_reports').delete().eq('id', id);
  if (error) fail(error);
}
