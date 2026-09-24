import { supabase } from './supabase.ts';
import { now } from './util.ts';
import { removeFiles, storagePathsIn, toServedImages, toStoredImages } from './services/personalFiles.ts';
import { cached, invalidate, invalidatePrefix, keys, put } from './cache.ts';
import { normalizeDomain, singleWordTopic, slugifyTopic } from '../../shared/types.ts';
import type { Dataset, DatasetSummary, Domain, ItemReport, ItemReportStatus, WorldMap } from '../../shared/types.ts';
import type { Changeset, ChatThread, PromptKind, PromptText } from '../../shared/chat.ts';

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
 * The shelf listing. Reads the summary columns straight off `taste_datasets`
 * (migration 007's generated columns — domain/topic/description/item_count/
 * subtopic_count are derived from `data` at write time) instead of the whole jsonb
 * blob, so this stays a few scalars per row rather than every item, description and
 * image URL in the account.
 */
export async function listDatasets(domain?: Domain): Promise<DatasetSummary[]> {
  return cached(keys.datasetList(domain), async () => {
    let query = supabase
      .from('taste_datasets')
      .select('id, domain, topic, description, item_count, subtopic_count, updated_at, private')
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
      private: !!row.private,
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

// ---- Claude chat: threads and changesets (shared/chat.ts, migration 008) ----
//
// Not cached: a thread is read precisely because it may have changed (a turn is
// running), and the traffic is one user's conversation.

const CHAT_MIGRATION_HINT =
  'The chat tables are missing. Run supabase/migrations/008_chat.sql in the Supabase SQL editor.';

function rowToThread(row: any): ChatThread {
  return { id: row.id, domain: row.domain ? normalizeDomain(row.domain) : null, ...row.data };
}

export async function saveThread(thread: ChatThread): Promise<void> {
  const { id, domain, ...data } = thread;
  const { error } = await supabase
    .from('taste_chat_threads')
    .upsert({ id, domain, data, updated_at: thread.updatedAt });
  if (missingRelation(error)) throw new Error(CHAT_MIGRATION_HINT);
  if (error) throw new Error(error.message);
}

export async function getThread(id: string): Promise<ChatThread | null> {
  const { data, error } = await supabase.from('taste_chat_threads').select('*').eq('id', id).maybeSingle();
  if (missingRelation(error)) throw new Error(CHAT_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return data ? rowToThread(data) : null;
}

/** Newest first. Whole rows: a summary needs the last message's status, and one
 *  person's threads are few enough that a projection isn't worth a generated column. */
export async function listThreads(limit = 40): Promise<ChatThread[]> {
  const { data, error } = await supabase
    .from('taste_chat_threads')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (missingRelation(error)) throw new Error(CHAT_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToThread);
}

export async function deleteThread(id: string): Promise<void> {
  const { error } = await supabase.from('taste_chat_threads').delete().eq('id', id);
  if (error && !missingRelation(error)) throw new Error(error.message);
  const { error: csError } = await supabase.from('taste_changesets').delete().eq('thread_id', id);
  if (csError && !missingRelation(csError)) throw new Error(csError.message);
}

function rowToChangeset(row: any): Changeset {
  return { id: row.id, threadId: row.thread_id, status: row.status, ...row.data };
}

export async function saveChangeset(cs: Changeset): Promise<void> {
  const { id, threadId, status, ...data } = cs;
  const { error } = await supabase
    .from('taste_changesets')
    .upsert({ id, thread_id: threadId, status, data, updated_at: cs.updatedAt });
  if (missingRelation(error)) throw new Error(CHAT_MIGRATION_HINT);
  if (error) throw new Error(error.message);
}

export async function getChangeset(id: string): Promise<Changeset | null> {
  const { data, error } = await supabase.from('taste_changesets').select('*').eq('id', id).maybeSingle();
  if (missingRelation(error)) throw new Error(CHAT_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return data ? rowToChangeset(data) : null;
}

/** Every changeset of a thread, oldest first — the open one (at most one) included. */
export async function listChangesets(threadId: string): Promise<Changeset[]> {
  const { data, error } = await supabase
    .from('taste_changesets')
    .select('*')
    .eq('thread_id', threadId)
    .order('updated_at', { ascending: true });
  if (missingRelation(error)) throw new Error(CHAT_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToChangeset);
}

// ---- Item reports: visitor-flagged problems from the public embed widget
// (shared/types.ts#ItemReport, migration 009). Filed by the visitor and dismissed by
// the curator straight from the browser (web/src/lib/db.ts); this side only reads
// them, for the agent (agentRun.ts, agentTools.ts#get_item_reports). ----

const REPORTS_MIGRATION_HINT =
  'The taste_item_reports table is missing. Run supabase/migrations/009_item_reports.sql in the Supabase SQL editor.';

function rowToReport(row: any): ItemReport {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    itemId: row.item_id,
    itemName: row.item_name ?? '',
    domain: normalizeDomain(row.domain),
    text: row.text,
    status: row.status === 'resolved' ? 'resolved' : 'open',
    createdAt: row.created_at,
  };
}

/** Newest first. `datasetId` narrows to one dataset; omit for every dataset. */
export async function listItemReports(filter: {
  datasetId?: string;
  status?: ItemReportStatus;
} = {}): Promise<ItemReport[]> {
  let query = supabase.from('taste_item_reports').select('*').order('created_at', { ascending: false });
  if (filter.datasetId) query = query.eq('dataset_id', filter.datasetId);
  if (filter.status) query = query.eq('status', filter.status);
  const { data, error } = await query;
  if (missingRelation(error)) throw new Error(REPORTS_MIGRATION_HINT);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToReport);
}

/** Open or close a report. The agent's way of closing the loop on one it has dealt
 *  with — only ever through an accepted changeset (services/changesets.ts). */
export async function setReportStatus(id: string, status: ItemReportStatus): Promise<void> {
  const { error } = await supabase.from('taste_item_reports').update({ status }).eq('id', id);
  if (missingRelation(error)) throw new Error(REPORTS_MIGRATION_HINT);
  if (error) throw new Error(error.message);
}

// ---- Prompt overrides: the rulebook and the saved commands as edited through the
// chat (migration 012, services/promptStore.ts). A row overrides the shipped file of
// the same name; no row means the file is current. ----

const PROMPTS_MIGRATION_HINT =
  'The taste_prompts table is missing. Run supabase/migrations/012_prompts.sql in the Supabase SQL editor.';

export interface PromptRow extends PromptText {
  name: string;
  kind: PromptKind;
  updatedAt: string;
}

function rowToPrompt(row: any): PromptRow {
  return {
    name: row.name,
    kind: row.kind === 'rules' ? 'rules' : 'command',
    description: row.description ?? '',
    body: row.body ?? '',
    updatedAt: row.updated_at ?? '',
  };
}

/** Every stored override. Before migration 012 is applied there are none — reads must
 *  not fail on that, or the agent loses its rulebook over a missing optional table. */
export async function listPromptOverrides(): Promise<PromptRow[]> {
  const { data, error } = await supabase.from('taste_prompts').select('*');
  if (missingRelation(error)) return [];
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToPrompt);
}

export async function getPromptOverride(name: string): Promise<PromptRow | null> {
  const { data, error } = await supabase.from('taste_prompts').select('*').eq('name', name).maybeSingle();
  if (missingRelation(error)) return null;
  if (error) throw new Error(error.message);
  return data ? rowToPrompt(data) : null;
}

export async function savePromptOverride(name: string, kind: PromptKind, text: PromptText): Promise<void> {
  const { error } = await supabase
    .from('taste_prompts')
    .upsert({ name, kind, description: text.description, body: text.body, updated_at: now() });
  if (missingRelation(error)) throw new Error(PROMPTS_MIGRATION_HINT);
  if (error) throw new Error(error.message);
}

export async function deletePromptOverride(name: string): Promise<void> {
  const { error } = await supabase.from('taste_prompts').delete().eq('name', name);
  if (missingRelation(error)) throw new Error(PROMPTS_MIGRATION_HINT);
  if (error) throw new Error(error.message);
}
