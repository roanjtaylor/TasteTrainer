import type {
  CoverageGap,
  Dataset,
  DatasetSummary,
  EloEntry,
  Item,
  ProposedItem,
  Subtopic,
} from '../../../shared/types';

async function http<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
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
    console.error(`[api] ${options?.method ?? 'GET'} ${url} -> ${res.status}`, raw.slice(0, 500));
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  // Datasets
  listDatasets: () => http<DatasetSummary[]>('/api/datasets'),
  getDataset: (id: string) => http<Dataset>(`/api/datasets/${id}`),
  createDataset: (body: {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    items: ProposedItem[];
  }) => http<Dataset>('/api/datasets', { method: 'POST', body: JSON.stringify(body) }),
  updateDataset: (id: string, body: Partial<Dataset>) =>
    http<Dataset>(`/api/datasets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDataset: (id: string) => http<void>(`/api/datasets/${id}`, { method: 'DELETE' }),

  // Curation
  proposeSubtopics: (topic: string, description: string) =>
    http<{ subtopics: Subtopic[] }>('/api/curation/subtopics', {
      method: 'POST',
      body: JSON.stringify({ topic, description }),
    }),
  generateItems: (body: {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    count: number;
    existingItems?: Item[];
  }) =>
    http<{ items: ProposedItem[] }>('/api/curation/items', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  findGaps: (body: { topic: string; description: string; subtopics: Subtopic[]; items: Item[] }) =>
    http<{ gaps: CoverageGap[] }>('/api/curation/gaps', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Images
  searchImages: (q: string) =>
    http<{ images: string[] }>(`/api/images/search?q=${encodeURIComponent(q)}`),

  // Comparison
  getPair: (id: string, scope: ScopeQuery) =>
    http<{ pair: { a: Item; b: Item } | null; progress: Progress }>(
      `/api/comparison/${id}/pair?${scopeQuery(scope)}`,
    ),
  vote: (id: string, winnerId: string, loserId: string) =>
    http<{ ok: true }>(`/api/comparison/${id}/vote`, {
      method: 'POST',
      body: JSON.stringify({ winnerId, loserId }),
    }),
  getLeaderboard: (id: string, scope: ScopeQuery) =>
    http<{ leaderboard: Array<{ item: Item; entry: EloEntry }>; progress: Progress }>(
      `/api/comparison/${id}/leaderboard?${scopeQuery(scope)}`,
    ),
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

function scopeQuery(scope: ScopeQuery): string {
  const params = new URLSearchParams();
  if (scope.subtopics?.length) params.set('subtopics', scope.subtopics.join(','));
  if (scope.eras?.length) params.set('eras', scope.eras.join(','));
  return params.toString();
}
