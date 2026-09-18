// A small in-process cache in front of Supabase.
//
// Why it exists: every screen in the app reads the same handful of rows over and
// over — the shelf re-lists datasets, and the dataset view and the filters subpage
// both fetch the same dataset. Without a cache each of those is a fresh Supabase
// round trip, which costs both latency (the slow first paint) and egress quota. With
// it, a warm server answers most GETs without touching the database at all.
//
// Deliberately not an LRU or an external cache: the working set is a few dozen small
// rows, one server process serves them, and writes go through this module's own
// invalidation — so a Map with TTLs is the whole requirement.

interface Entry<T> {
  value: T;
  /** Epoch ms after which the value must be re-read. */
  expiresAt: number;
}

/** How long a cached read stays authoritative. Writes invalidate explicitly, so
 *  this only bounds staleness from changes made by *another* server instance. */
const DEFAULT_TTL_MS = 60_000;

const store = new Map<string, Entry<unknown>>();
/** In-flight reads, so N concurrent misses for one key make ONE database call. */
const inflight = new Map<string, Promise<unknown>>();

/**
 * Read `key` from cache, or load it (once, even under concurrent callers) and cache
 * the result. A loader that throws is never cached — the next call retries.
 */
export async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Write a value straight into the cache — used after a save, so the next read is
 *  warm rather than merely not-wrong. */
export function put<T>(key: string, value: T, ttlMs: number = DEFAULT_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** Drop one key. */
export function invalidate(key: string): void {
  store.delete(key);
}

/** Drop every key starting with `prefix` — how a write clears the derived entries
 *  it affects (e.g. saving a dataset clears every cached shelf listing). */
export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

// ---- Cache keys, in one place so invalidation can't drift from reads ----
export const keys = {
  datasetList: (domain?: string) => `datasets:list:${domain ?? 'all'}`,
  datasetListPrefix: 'datasets:list:',
  dataset: (id: string) => `datasets:one:${id}`,
  worldMap: (domain: string) => `worldmap:${domain}`,
};
