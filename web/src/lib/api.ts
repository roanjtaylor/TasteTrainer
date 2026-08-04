import type {
  CoverageGap,
  Dataset,
  DatasetSummary,
  Domain,
  EraGroup,
  FieldMapReview,
  Item,
  LeaderboardRow,
  Ranker,
  RankerSummary,
  Subtopic,
  ProposedItem,
  WorldMap,
} from '../../../shared/types';

// In dev the Vite proxy forwards /api to localhost:5174 (vite.config.ts).
// In production VITE_API_BASE_URL points at the deployed backend on Render.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

async function http<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    // Read the body once as text so we can surface non-JSON errors too — e.g. a
    // Vite proxy 500 when the backend is down is plain text, not our { error } shape.
    const raw = await res.text().catch(() => '');
    try {
      const body = raw ? JSON.parse(raw) : null;
      if (body?.error) message = body.error;
    } catch {
      if (raw) message = `Request failed (${res.status}): ${raw.slice(0, 200)}`;
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type OnProgress = (line: string) => void;

// POST a body and consume the backend's Server-Sent Event stream (see
// server/src/routes/curation.ts): `progress` lines drive the live status, then a
// single `done` payload resolves (or an `error` rejects). We use fetch + a stream
// reader rather than EventSource because EventSource can't POST a request body.
async function streamSSE<T>(url: string, body: unknown, onProgress?: OnProgress): Promise<T> {
  const res = await fetch(API_BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // Pre-stream failures (e.g. validation) come back as a normal JSON error, not SSE.
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const b = await res.json();
      if (b?.error) message = b.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: T | undefined;
  let errorMessage: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    // Events are separated by a blank line; a `data:` line carries the JSON payload.
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      let event = 'message';
      let data = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === 'progress') onProgress?.(parsed.line);
      else if (event === 'done') result = parsed as T;
      else if (event === 'error') errorMessage = parsed.error;
    }
  }

  if (errorMessage) throw new Error(errorMessage);
  if (result === undefined) throw new Error('Stream ended without a result.');
  return result;
}

export const api = {
  // Datasets
  listDatasets: (domain?: Domain) =>
    http<DatasetSummary[]>(`/api/datasets${domain ? `?domain=${domain}` : ''}`),
  getDataset: (id: string) => http<Dataset>(`/api/datasets/${id}`),
  createDataset: (body: {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    items: ProposedItem[];
    domain: Domain;
  }) => http<Dataset>('/api/datasets', { method: 'POST', body: JSON.stringify(body) }),
  updateDataset: (id: string, body: Partial<Dataset>) =>
    http<Dataset>(`/api/datasets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDataset: (id: string) => http<void>(`/api/datasets/${id}`, { method: 'DELETE' }),

  // Curation — these stream live progress (onProgress) and resolve with the result.
  proposeSubtopics: (topic: string, description: string, domain: Domain, onProgress?: OnProgress) =>
    streamSSE<{ subtopics: Subtopic[]; suggestedCount: number }>(
      '/api/curation/subtopics',
      { topic, description, domain },
      onProgress,
    ),
  generateItems: (
    body: {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      count: number;
      domain: Domain;
      /** The field's named periods, turned into an explicit per-era quota server-side. */
      eraGroups?: EraGroup[];
      existingItems?: Item[];
    },
    onProgress?: OnProgress,
  ) => streamSSE<{ items: ProposedItem[] }>('/api/curation/items', body, onProgress),
  // `items` is optional — the curate flow asks for periods before any items exist.
  generatePeriods: (
    body: { topic: string; description: string; items?: Item[]; domain: Domain },
    onProgress?: OnProgress,
  ) => streamSSE<{ eraGroups: EraGroup[] }>('/api/curation/periods', body, onProgress),
  // "Check this world" — the world-level map review. The server assembles the shelf
  // inventory itself, so the only input is which world to audit.
  // Returns the review AND the map it merged into: one press both audits the world
  // and updates its map. `map` is null if the map couldn't be saved (e.g. migration
  // 003 not applied) — the review half still works.
  // `redraw` discards the stored map and starts over — the escape hatch from a first
  // draw whose axes or regions turned out badly, since nothing else can change them.
  reviewFieldMap: (domain: Domain, onProgress?: OnProgress, redraw = false) =>
    streamSSE<FieldMapReview & { map: WorldMap | null }>(
      '/api/curation/field-map',
      { domain, redraw },
      onProgress,
    ),
  findGaps: (
    body: {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      items: Item[];
      domain: Domain;
    },
    onProgress?: OnProgress,
  ) => streamSSE<{ gaps: CoverageGap[]; suggestedCount: number }>(
    '/api/curation/gaps',
    body,
    onProgress,
  ),
  fillGaps: (
    body: {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      items: Item[];
      gaps: CoverageGap[];
      count: number;
      feedback: string;
      domain: Domain;
      eraGroups?: EraGroup[];
    },
    onProgress?: OnProgress,
  ) =>
    streamSSE<{ items: ProposedItem[]; note: string }>('/api/curation/gap-fill', body, onProgress),

  // The world map (8-field-map.md). Generating it belongs to the review above; these
  // are the map as an object you own — where you dragged things, and which of the
  // review's suggestions you took.
  getWorldMap: (domain: Domain) => http<{ map: WorldMap | null }>(`/api/map/${domain}`),
  updateWorldMap: (
    domain: Domain,
    body: {
      regionNames?: Record<string, string>;
      axes?: WorldMap['axes'];
      accept?: string;
      dismiss?: string;
    },
  ) => http<{ map: WorldMap }>(`/api/map/${domain}`, { method: 'PUT', body: JSON.stringify(body) }),

  // Images
  searchImages: (q: string) =>
    http<{ images: string[] }>(`/api/images/search?q=${encodeURIComponent(q)}`),
  // Software domain's alternative picker (7-software-design.md): candidate Wayback/live
  // screenshots for a site url, near an optional target year.
  screenshotCandidates: (url: string, year: number | null) =>
    http<{ images: string[] }>(
      `/api/images/screenshot?url=${encodeURIComponent(url)}${year != null ? `&year=${year}` : ''}`,
    ),

  // Comparison — every call is scoped to a ranker (a typed name), so each person
  // builds their own ranking of the same dataset. `getLeaderboard` also accepts the
  // pseudo-ranker "everyone" for the pooled view.
  listRankers: (id: string) =>
    http<{ rankers: RankerSummary[] }>(`/api/comparison/${id}/rankers`),
  getPair: (id: string, ranker: Ranker, scope: ScopeQuery) =>
    http<{ pair: { a: Item; b: Item } | null; progress: Progress }>(
      `/api/comparison/${id}/pair?${scopeQuery(scope, ranker.name)}`,
    ),
  vote: (id: string, ranker: Ranker, winnerId: string, loserId: string) =>
    http<{ ok: true; comparisons: number }>(`/api/comparison/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ ranker: ranker.name, winnerId, loserId }),
    }),
  getLeaderboard: (id: string, ranker: string, scope: ScopeQuery) =>
    http<{
      ranker: string;
      rankerCount?: number;
      leaderboard: LeaderboardRow[];
      progress: Progress;
    }>(`/api/comparison/${id}/leaderboard?${scopeQuery(scope, ranker)}`),
};

export interface Progress {
  done: number;
  target: number;
  complete: boolean;
}

export interface ScopeQuery {
  subtopics?: string[];
  eras?: string[];
}

function scopeQuery(scope: ScopeQuery, ranker?: string): string {
  const params = new URLSearchParams();
  if (scope.subtopics?.length) params.set('subtopics', scope.subtopics.join(','));
  if (scope.eras?.length) params.set('eras', scope.eras.join(','));
  if (ranker) params.set('ranker', ranker);
  return params.toString();
}
