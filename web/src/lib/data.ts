import { slugifyTopic } from '../../../shared/types';
import type { Dataset, DatasetSummary, Domain, WorldMap } from '../../../shared/types';
import { api } from './api';
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
 * server resolves either. The cache is what makes returning to a dataset free.
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
export function publishDataset(ds: Dataset): void {
  write(cacheKeys.dataset(ds.id), ds);
  write(cacheKeys.dataset(slugifyTopic(ds.topic)), ds);
}

/**
 * One world's map. Cached hard: it changes only when you accept map changes Claude
 * proposed, and that publishes the new map straight into this cache (lib/chat.ts) — so
 * there is nothing to poll for, and the shelf paints the map instantly on every visit.
 */
export function useWorldMap(domain: Domain | null): CachedResource<WorldMap | null> {
  return useCached(
    domain ? cacheKeys.worldMap(domain) : null,
    () => api.getWorldMap(domain as Domain).then((r) => r.map),
    { maxAgeMs: 5 * 60_000 },
  );
}

/** Publish a map the server just handed back, without a refetch. */
export function publishWorldMap(domain: Domain, map: WorldMap | null): void {
  write(cacheKeys.worldMap(domain), map);
}

// ---- Mutations ----

/** Save a dataset and publish the returned state, so every screen showing it updates
 *  without a refetch. */
export async function saveDataset(idOrSlug: string, body: Partial<Dataset>): Promise<Dataset> {
  const updated = await api.updateDataset(idOrSlug, body);
  // Renaming a dataset changes its slug, so the address it was saved through can be
  // an address it no longer answers to. Drop it before republishing the live ones.
  drop(cacheKeys.dataset(idOrSlug));
  publishDataset(updated);
  drop(cacheKeys.datasetListPrefix, { prefix: true });
  return updated;
}

export async function createDataset(body: Parameters<typeof api.createDataset>[0]): Promise<Dataset> {
  const created = await api.createDataset(body);
  publishDataset(created);
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
}
