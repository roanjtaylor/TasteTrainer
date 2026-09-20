import { useCallback, useEffect, useRef, useState } from 'react';

// Client-side read cache: stale-while-revalidate over localStorage.
//
// The problem it solves: every screen used to start from an empty state and wait on a
// network round trip before it could render anything — so opening a dataset you looked
// at ten seconds ago cost exactly as much as opening it for the first time, and each
// of those trips was another read billed against the database. Datasets barely change
// between visits, which makes that repetition pure waste.
//
// So: three layers, cheapest first.
//   1. A module-level Map — a revisit in the same session is synchronous, no parsing.
//   2. localStorage — a revisit in a NEW session paints immediately from the last
//      known value, then quietly corrects itself if the server disagrees.
//   3. The network — always consulted, but off the critical path whenever a cached
//      value exists, and de-duplicated so N components asking at once make ONE request.
//
// The trade is that a screen can show a value a few seconds out of date for the moment
// before revalidation lands. For a catalogue of historical work that is invisible; for
// anything where it isn't (the next comparison pair), the caller just doesn't cache.

const VERSION = 'tt2'; // bump to invalidate every stored entry after a shape change
const PREFIX = `${VERSION}:`;

interface Envelope<T> {
  /** Epoch ms the value was stored. */
  at: number;
  data: T;
}

/** Layer 1. Survives navigation within a session; dies with the tab. */
const memory = new Map<string, Envelope<unknown>>();

/** Layer 3's de-duplication: one in-flight request per key, shared by every caller. */
const inflight = new Map<string, Promise<unknown>>();

/** Subscribers per key, so a refresh in one component updates every component showing it. */
const listeners = new Map<string, Set<(data: unknown) => void>>();

/** Mounted `useCached` instances per key, so `drop()` can make them refetch — without
 *  this, a screen that's been open since before a write (the shelf left sitting on
 *  /personal while a dataset gets created elsewhere) never learns its cached list was
 *  invalidated: nothing re-runs its fetch until it happens to unmount and remount. */
const watchers = new Map<string, Set<() => void>>();

function storageKey(key: string): string {
  return PREFIX + key;
}

function readStorage<T>(key: string): Envelope<T> | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Envelope<T>;
    return typeof parsed?.at === 'number' ? parsed : null;
  } catch {
    // Unreadable/corrupt entry, or storage blocked entirely (private mode, embedded
    // webview). Never fatal — the cache is an optimisation, not a source of truth.
    return null;
  }
}

function writeStorage<T>(key: string, envelope: Envelope<T>): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(envelope));
  } catch {
    // Almost always the quota. Drop our oldest entries and try once more; if it still
    // fails, carry on uncached rather than breaking the screen.
    evictOldest();
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(envelope));
    } catch {
      /* give up quietly */
    }
  }
}

/** Remove the least recently stored third of our entries. Only ever touches keys we own. */
function evictOldest(): void {
  try {
    const ours: Array<{ key: string; at: number }> = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      let at = 0;
      try {
        at = JSON.parse(localStorage.getItem(key) ?? '{}')?.at ?? 0;
      } catch {
        /* treat unparseable as oldest */
      }
      ours.push({ key, at });
    }
    ours.sort((a, b) => a.at - b.at);
    for (const { key } of ours.slice(0, Math.max(1, Math.ceil(ours.length / 3)))) {
      localStorage.removeItem(key);
    }
  } catch {
    /* nothing sensible to do */
  }
}

/** The freshest cached value for a key, from memory or storage. */
export function peek<T>(key: string): Envelope<T> | null {
  const hit = memory.get(key);
  if (hit) return hit as Envelope<T>;
  const stored = readStorage<T>(key);
  if (stored) memory.set(key, stored);
  return stored;
}

/** Publish a value to every layer and every subscriber. */
export function write<T>(key: string, data: T): void {
  const envelope: Envelope<T> = { at: Date.now(), data };
  memory.set(key, envelope);
  writeStorage(key, envelope);
  listeners.get(key)?.forEach((notify) => notify(data));
}

/** Forget one key, or every key starting with `key` when `prefix` is set. */
export function drop(key: string, { prefix = false } = {}): void {
  const matches = (candidate: string) => (prefix ? candidate.startsWith(key) : candidate === key);
  const dropped: string[] = [];

  for (const candidate of [...memory.keys()]) {
    if (matches(candidate)) {
      memory.delete(candidate);
      dropped.push(candidate);
    }
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const full = localStorage.key(i);
      if (full?.startsWith(PREFIX) && matches(full.slice(PREFIX.length))) {
        localStorage.removeItem(full);
        const bare = full.slice(PREFIX.length);
        if (!dropped.includes(bare)) dropped.push(bare);
      }
    }
  } catch {
    /* storage unavailable — memory eviction above is enough */
  }

  // Anything currently mounted and showing one of these keys is stale right now, not
  // just next time it mounts — kick it into an immediate refetch.
  for (const droppedKey of dropped) {
    watchers.get(droppedKey)?.forEach((refetch) => refetch());
  }
}

/** Forget everything — on sign-out (lib/auth.tsx), so the next person at this
 *  browser isn't painted the last one's datasets out of localStorage. */
export function clearAll(): void {
  drop('', { prefix: true });
}

/**
 * Fetch through the cache. Concurrent callers for the same key share one request,
 * which is what keeps React's StrictMode double-effects (and two components wanting
 * the same dataset) from doubling the traffic.
 */
export function load<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((data) => {
      write(key, data);
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

/** Warm a key without rendering it — used to fetch a dataset on link hover. */
export function prefetch<T>(key: string, fetcher: () => Promise<T>, maxAgeMs = 60_000): void {
  const hit = peek<T>(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return;
  load(key, fetcher).catch(() => {
    /* speculative — a failure here is not the user's problem */
  });
}

export interface CachedResource<T> {
  /** The cached value if there is one, then the fresh value once it lands. */
  data: T | undefined;
  /** True only when there is nothing at all to show yet. */
  loading: boolean;
  /** Set when the network failed AND there was no cached value to fall back on. */
  error: string;
  /** True while a background revalidation is running behind already-shown data. */
  revalidating: boolean;
  /** Force a re-read, ignoring freshness. */
  refresh: () => Promise<T | undefined>;
  /** Replace the cached value locally — for when a write already returned the new state. */
  set: (data: T) => void;
}

/**
 * Subscribe a component to a cached resource.
 *
 * Renders the cached value on the very first paint when there is one, so navigating
 * back to a screen you've seen is instant, and only shows a loading state the first
 * time a key is ever requested. Pass `key: null` to stand down entirely (e.g. before
 * a route param is known).
 */
export function useCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  { maxAgeMs = 30_000 }: { maxAgeMs?: number } = {},
): CachedResource<T> {
  const [data, setData] = useState<T | undefined>(() => (key ? peek<T>(key)?.data : undefined));
  const [error, setError] = useState('');
  const [revalidating, setRevalidating] = useState(false);

  // When the key changes, swap to the new key's cached value during this render rather
  // than in an effect — otherwise there'd be one committed frame showing the PREVIOUS
  // key's data under the new key, which reads as the wrong dataset flashing up.
  const [renderedKey, setRenderedKey] = useState(key);
  if (key !== renderedKey) {
    setRenderedKey(key);
    setData(key ? peek<T>(key)?.data : undefined);
    setError('');
  }

  // Keep the latest fetcher without making it a dependency — callers pass inline
  // closures, and depending on their identity would refetch on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(
    async (force: boolean): Promise<T | undefined> => {
      if (!key) return undefined;
      const hit = peek<T>(key);
      if (hit) setData(hit.data);
      if (!force && hit && Date.now() - hit.at < maxAgeMs) return hit.data;

      setRevalidating(true);
      try {
        const fresh = await load<T>(key, () => fetcherRef.current());
        setError('');
        return fresh;
      } catch (e: any) {
        // A cached value is better than an error screen: only surface the failure
        // when there is genuinely nothing to show.
        if (!hit) setError(e?.message ?? 'Could not load');
        return hit?.data;
      } finally {
        setRevalidating(false);
      }
    },
    [key, maxAgeMs],
  );

  useEffect(() => {
    if (!key) return;
    setData(peek<T>(key)?.data);

    const notify = (next: unknown) => setData(next as T);
    const set = listeners.get(key) ?? new Set();
    set.add(notify);
    listeners.set(key, set);

    const refetch = () => void run(true);
    const watcherSet = watchers.get(key) ?? new Set();
    watcherSet.add(refetch);
    watchers.set(key, watcherSet);

    run(false);

    return () => {
      set.delete(notify);
      if (!set.size) listeners.delete(key);
      watcherSet.delete(refetch);
      if (!watcherSet.size) watchers.delete(key);
    };
  }, [key, run]);

  const set = useCallback(
    (next: T) => {
      if (key) write(key, next);
      else setData(next);
    },
    [key],
  );

  return {
    data,
    loading: data === undefined && !error,
    error,
    revalidating,
    refresh: useCallback(() => run(true), [run]),
    set,
  };
}

// ---- Cache keys ----
// Centralised so a write can invalidate exactly what it affects.
export const cacheKeys = {
  datasetList: (domain: string) => `datasets:${domain}`,
  datasetListPrefix: 'datasets:',
  dataset: (id: string) => `dataset:${id}`,
  worldMap: (domain: string) => `worldmap:${domain}`,
};
