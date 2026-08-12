import { slugifyTopic } from '../../../shared/types';
import type {
  BoundaryFixResult,
  Dataset,
  DatasetSummary,
  Domain,
  Ranker,
  WorldMap,
} from '../../../shared/types';
import { api } from './api';
import type { ScopeQuery } from './api';
import { cacheKeys, drop, prefetch, useCached, write, type CachedResource } from './store';

// The read/write seam between the API and the client cache (lib/store.ts).
//
// Reads go through `useCached`, so a screen paints from the last known value and
// corrects itself in the background. Writes go through the mutators below, which are
// the only place cache invalidation happens — keeping "what changed" and "what to
// forget" in one file rather than scattered across the components that happen to save.

/** The shelf. Barely changes between visits, so it revalidates lazily. */
export function useDatasetList(domain: Domain | null): CachedResource<DatasetSummary[]> {
  return useCached(
    domain ? cacheKeys.datasetList(domain) : null,
    () => api.listDatasets(domain as Domain),
    { maxAgeMs: 60_000 },
  );
}

/**
 * One dataset in full, addressed by slug (the URL: /physical/ships) or by id — the
 * server resolves either. Shared by the dataset view and the filters subpage; the
 * cache is what stops moving between them refetching the same thing.
 */
export function useDataset(idOrSlug: string | null): CachedResource<Dataset> {
  return useCached(
    idOrSlug ? cacheKeys.dataset(idOrSlug) : null,
    () => api.getDataset(idOrSlug as string),
    { maxAgeMs: 60_000 },
  );
}

/** Warm a dataset before it's needed — called on shelf-card hover, so the click
 *  usually lands on an already-loaded screen. */
export function prefetchDataset(idOrSlug: string): void {
  prefetch(cacheKeys.dataset(idOrSlug), () => api.getDataset(idOrSlug));
}

/** Cache a dataset under both addresses it answers to. A screen reached by slug and
 *  a save made by id are the same dataset; writing one key would leave the other
 *  serving the pre-save copy. */
function publish(ds: Dataset): void {
  write(cacheKeys.dataset(ds.id), ds);
  write(cacheKeys.dataset(slugifyTopic(ds.topic)), ds);
}

/**
 * One world's map. Cached hard: it changes only when you drag something or run a
 * review, both of which write through `saveWorldMap` below — so there is nothing to
 * poll for, and the shelf should paint the map instantly on every return visit.
 */
export function useWorldMap(domain: Domain | null): CachedResource<WorldMap | null> {
  return useCached(
    domain ? cacheKeys.worldMap(domain) : null,
    () => api.getWorldMap(domain as Domain).then((r) => r.map),
    { maxAgeMs: 5 * 60_000 },
  );
}

/** Write a map edit through and republish it, so the canvas reflects a drop at once. */
export async function saveWorldMap(
  domain: Domain,
  body: Parameters<typeof api.updateWorldMap>[1],
): Promise<WorldMap> {
  const { map } = await api.updateWorldMap(domain, body);
  write(cacheKeys.worldMap(domain), map);
  return map;
}

/** Publish a map the review just produced, without a refetch. */
export function publishWorldMap(domain: Domain, map: WorldMap | null): void {
  write(cacheKeys.worldMap(domain), map);
}

/** Everyone who has ranked a dataset. */
export function useRankers(datasetId: string | null) {
  return useCached(
    datasetId ? cacheKeys.rankers(datasetId) : null,
    () => api.listRankers(datasetId as string).then((r) => r.rankers),
    { maxAgeMs: 15_000 },
  );
}

/**
 * A leaderboard for one (dataset, ranker, scope). Cached so flipping between name
 * tabs is instant after the first look, with a short freshness window because votes
 * land continuously while a session is running.
 */
export function useLeaderboard(datasetId: string | null, ranker: string, scope: ScopeQuery) {
  const scopeKey = JSON.stringify(scope);
  return useCached(
    datasetId ? cacheKeys.leaderboard(datasetId, ranker, scopeKey) : null,
    () => api.getLeaderboard(datasetId as string, ranker, scope),
    { maxAgeMs: 10_000 },
  );
}

// ---- Mutations ----

/** Save a dataset and publish the returned state, so every screen showing it updates
 *  without a refetch. */
export async function saveDataset(idOrSlug: string, body: Partial<Dataset>): Promise<Dataset> {
  const updated = await api.updateDataset(idOrSlug, body);
  // Renaming a dataset changes its slug, so the address it was saved through can be
  // an address it no longer answers to. Drop it before republishing the live ones.
  drop(cacheKeys.dataset(idOrSlug));
  publish(updated);
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  // Item membership may have changed, which changes what any board can contain.
  drop(cacheKeys.leaderboardPrefix(updated.id), { prefix: true });
  return updated;
}

export async function createDataset(body: Parameters<typeof api.createDataset>[0]): Promise<Dataset> {
  const created = await api.createDataset(body);
  publish(created);
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  return created;
}

/** Takes the topic as well as the id because a dataset is cached under both of its
 *  addresses, and both have to go. */
export async function deleteDataset(id: string, topic: string): Promise<void> {
  await api.deleteDataset(id);
  drop(cacheKeys.dataset(id));
  drop(cacheKeys.dataset(slugifyTopic(topic)));
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  drop(cacheKeys.leaderboardPrefix(id), { prefix: true });
  drop(cacheKeys.rankers(id));
}

/**
 * Sync the client cache after a boundary fix — the server route that backs it writes
 * datasets directly via `storage.ts` rather than through the `saveDataset`/
 * `createDataset`/`deleteDataset` mutators above, so none of their cache invalidation
 * ran. Without this, a field carved out into a brand-new dataset (or one absorbed and
 * deleted) is correct in Supabase the moment "Accept changes" resolves, but the shelf
 * and map both keep serving their pre-fix `useDatasetList` cache — up to a minute old
 * — so the new field looks like it was never created.
 */
export function publishBoundaryFix(result: BoundaryFixResult): void {
  for (const ds of result.updated) {
    publish(ds);
    drop(cacheKeys.leaderboardPrefix(ds.id), { prefix: true });
  }
  for (const topic of result.deletedTopics) {
    drop(cacheKeys.dataset(slugifyTopic(topic)));
  }
  drop(cacheKeys.datasetListPrefix, { prefix: true });
}

/** Record one choice. Every board for this dataset is now stale, including the
 *  pooled one and the list of who has ranked it (this may be a first vote). */
export async function vote(
  datasetId: string,
  ranker: Ranker,
  winnerId: string,
  loserId: string,
): Promise<void> {
  await api.vote(datasetId, ranker, winnerId, loserId);
  drop(cacheKeys.leaderboardPrefix(datasetId), { prefix: true });
  drop(cacheKeys.rankers(datasetId));
}
