import type { Dataset, DatasetSummary, Domain, Ranker } from '../../../shared/types';
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

/** One dataset in full. Shared by the dataset view and the filters subpage — the
 *  cache is what stops moving between them refetching the same thing. */
export function useDataset(id: string | null): CachedResource<Dataset> {
  return useCached(id ? cacheKeys.dataset(id) : null, () => api.getDataset(id as string), {
    maxAgeMs: 60_000,
  });
}

/** Warm a dataset before it's needed — called on shelf-card hover, so the click
 *  usually lands on an already-loaded screen. */
export function prefetchDataset(id: string): void {
  prefetch(cacheKeys.dataset(id), () => api.getDataset(id));
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
export async function saveDataset(id: string, body: Partial<Dataset>): Promise<Dataset> {
  const updated = await api.updateDataset(id, body);
  write(cacheKeys.dataset(id), updated);
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  // Item membership may have changed, which changes what any board can contain.
  drop(cacheKeys.leaderboardPrefix(id), { prefix: true });
  return updated;
}

export async function createDataset(body: Parameters<typeof api.createDataset>[0]): Promise<Dataset> {
  const created = await api.createDataset(body);
  write(cacheKeys.dataset(created.id), created);
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  return created;
}

export async function deleteDataset(id: string): Promise<void> {
  await api.deleteDataset(id);
  drop(cacheKeys.dataset(id));
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  drop(cacheKeys.leaderboardPrefix(id), { prefix: true });
  drop(cacheKeys.rankers(id));
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
