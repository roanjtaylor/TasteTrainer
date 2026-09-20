import type {
  BoundaryFixResult,
  BrainSetup,
  BoundaryKind,
  CoverageGap,
  Dataset,
  DatasetSummary,
  Domain,
  EmbedDataset,
  EraGroup,
  FieldMapReview,
  FillMode,
  ImageCandidate,
  ImageKind,
  Item,
  Job,
  LikedTweetRef,
  Subtopic,
  TweetImportStats,
  ProposedItem,
  WorldMap,
} from '../../../shared/types';
import type {
  Changeset,
  ChangesetResult,
  ChatEffort,
  ChatModel,
  ChatStreamEvent,
  ChatThread,
  ChatThreadSummary,
  ChatView,
} from '../../../shared/chat';
import { accessToken } from './supabase';

// In dev the Vite proxy forwards /api to localhost:5174 (vite.config.ts).
// In production VITE_API_BASE_URL points at the deployed backend on Render.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Every request carries the signed-in session's access token — the server refuses
 * anything under /api without one (server/src/auth.ts). Read per request rather than
 * held in a variable: supabase-js refreshes the token in the background roughly
 * hourly, and a long-lived tab would otherwise go on sending the expired one.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function http<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    headers: await authHeaders(),
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

/** `jobId` rides along on progress lines from the durable calls (server's `jobSend`),
 *  so the caller can pair its transient notification with the durable job row while
 *  the call is still in flight. Absent for the plain, non-durable calls. */
export type OnProgress = (line: string, jobId?: string) => void;

// POST a body and consume the backend's Server-Sent Event stream (see
// server/src/routes/curation.ts): `progress` lines drive the live status, then a
// single `done` payload resolves (or an `error` rejects). We use fetch + a stream
// reader rather than EventSource because EventSource can't POST a request body.
async function streamSSE<T>(url: string, body: unknown, onProgress?: OnProgress): Promise<T> {
  const res = await fetch(API_BASE + url, {
    method: 'POST',
    headers: await authHeaders(),
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
      if (event === 'progress') onProgress?.(parsed.line, parsed.jobId);
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
  // Public embed widget (no auth — server/src/routes/embed.ts). Same `http()` helper
  // as everything else; it's harmless that this also sends an auth header when one
  // exists, the endpoint just ignores it.
  getEmbed: (id: string) => http<EmbedDataset>(`/api/embed/${id}`),

  // Curation — these stream live progress (onProgress) and resolve with the result.
  // "Map the field": subtopics AND the era-periods that steer research, in one durable
  // call (see jobId below) — the client treats the two as a single step.
  proposeSubtopics: (topic: string, description: string, domain: Domain, onProgress?: OnProgress) =>
    streamSSE<{ subtopics: Subtopic[]; suggestedCount: number; eraGroups: EraGroup[]; jobId: string }>(
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
    // `jobId` identifies the durable row this call was tracked under (web/lib/jobs.ts)
    // — present once it's `done`, so a live caller can delete it the moment its
    // proposal is saved or discarded, same as a resumed one does.
  ) => streamSSE<{ items: ProposedItem[]; jobId: string }>('/api/curation/items', body, onProgress),
  // "Re-fetch images" — run the current image pipeline over a dataset that is already
  // saved. Images used to be resolved only at curation time, so every sourcing
  // improvement applied to future items and left existing ones untouched. Returns the
  // updated items for review; nothing is written until you save.
  reResolveImages: (
    body: { datasetId: string; onlyProblems?: boolean },
    onProgress?: OnProgress,
  ) => streamSSE<{ items: Item[]; checked: number; changed: number }>(
    '/api/curation/re-resolve',
    body,
    onProgress,
  ),
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
  // "Accept changes" on a boundary issue — hands the review's own wording straight
  // back to the server, which resolves it to the actual dataset(s) and asks Claude to
  // work out the concrete fix. `fields` must be exactly `BoundaryIssue.fields`.
  applyBoundaryFix: (
    body: { domain: Domain; kind: BoundaryKind; fields: string[]; proposal: string; why: string },
    onProgress?: OnProgress,
  ) =>
    streamSSE<BoundaryFixResult & { map: WorldMap | null }>(
      '/api/curation/boundary-fix',
      body,
      onProgress,
    ),
  findGaps: (
    body: {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      items: Item[];
      domain: Domain;
      // The field's named periods, so a reported gap can be phrased as "the Post-War
      // period is thin" rather than a bare year range.
      eraGroups?: EraGroup[];
      // An area to read more closely — the sweep still covers the whole field.
      focus?: string;
    },
    onProgress?: OnProgress,
    // See generateItems' jobId above.
  ) => streamSSE<{ gaps: CoverageGap[]; suggestedCount: number; jobId: string }>(
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
      // 'direct' makes `feedback` the brief itself rather than a steer on the gaps.
      mode?: FillMode;
      domain: Domain;
      eraGroups?: EraGroup[];
    },
    onProgress?: OnProgress,
  ) =>
    streamSSE<{
      items: ProposedItem[];
      note: string;
      // What the server's hygiene pass had to correct: proposals dropped as repeats,
      // and proposals whose subtopic was off-list and now needs one picked.
      duplicates: number;
      unsetSubtopics: number;
      // See generateItems' jobId above.
      jobId: string;
    }>('/api/curation/gap-fill', body, onProgress),

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
  // The digital picker's real source: every candidate the resolver cascade can find for
  // one item — web archive, Wikipedia, Commons, Internet Archive, image search — each
  // scored and labelled. Supersedes screenshotCandidates for the picker, because a
  // url-only search offers nothing for the pre-web half of the digital world.
  imageCandidates: (q: {
    name: string;
    year: number | null;
    kind?: ImageKind;
    url?: string;
    wikipediaTitle?: string;
    query?: string;
  }) => {
    const p = new URLSearchParams({ name: q.name });
    if (q.year != null) p.set('year', String(q.year));
    if (q.kind) p.set('kind', q.kind);
    if (q.url) p.set('url', q.url);
    if (q.wikipediaTitle) p.set('wikipediaTitle', q.wikipediaTitle);
    if (q.query) p.set('query', q.query);
    return http<{ candidates: ImageCandidate[] }>(`/api/images/candidates?${p}`);
  },

  // Your own files (personal world — lib/files.ts drives these as a pair around a
  // direct browser→Storage upload). `createUpload` names the destination and returns a
  // single-use token for it; `signFile` turns the uploaded path into a showable link.
  createUpload: (contentType: string) =>
    http<{ bucket: string; path: string; token: string }>('/api/files/uploads', {
      method: 'POST',
      body: JSON.stringify({ contentType }),
    }),
  signFile: (path: string) =>
    http<{ url: string }>('/api/files/signed', { method: 'POST', body: JSON.stringify({ path }) }),

  // Liked tweets into a personal dataset (server/src/routes/tweets.ts) — one batch;
  // components/TweetImportPanel.tsx loops it over a whole archive.
  importTweets: (datasetId: string, likes: LikedTweetRef[]) =>
    http<{ dataset: Dataset; stats: TweetImportStats }>('/api/tweets/import', {
      method: 'POST',
      body: JSON.stringify({ datasetId, likes }),
    }),

  // Durable curation jobs (web/lib/jobs.ts) — what survives a refresh mid-Claude-call,
  // and what the resume banner reads. `domain` omitted lists across both worlds.
  listJobs: (domain?: Domain) =>
    http<Job[]>(`/api/curation/jobs${domain ? `?domain=${domain}` : ''}`),
  getJob: (id: string) => http<Job>(`/api/curation/jobs/${id}`),
  deleteJob: (id: string) => http<void>(`/api/curation/jobs/${id}`, { method: 'DELETE' }),

  // The settings cog (components/BrainPanel.tsx): how the server prompts Claude —
  // model, rulebook, every call and its last real run. Read-only.
  getBrain: () => http<BrainSetup>('/api/brain'),

  // The Claude chat (server/src/routes/chat.ts). Sending returns as soon as the turn
  // has STARTED; the reply is watched with `watchChat` below.
  chatModels: () => http<{ models: ChatModel[]; defaultModel: string }>('/api/chat/models'),
  chatThreads: () => http<ChatThreadSummary[]>('/api/chat/threads'),
  chatThread: (id: string) =>
    http<{ thread: ChatThread; changesets: Changeset[]; running: boolean }>(`/api/chat/threads/${id}`),
  deleteChatThread: (id: string) => http<void>(`/api/chat/threads/${id}`, { method: 'DELETE' }),
  sendChat: (body: { threadId?: string; text: string; view: ChatView; model?: string; effort?: ChatEffort }) =>
    http<{ thread: ChatThread }>('/api/chat/messages', { method: 'POST', body: JSON.stringify(body) }),
  stopChat: (id: string) => http<{ stopped: boolean }>(`/api/chat/threads/${id}/stop`, { method: 'POST' }),
  getChangeset: (id: string) => http<Changeset>(`/api/chat/changesets/${id}`),
  applyChangeset: (id: string, body: { opIds?: string[]; force?: boolean }) =>
    http<ChangesetResult>(`/api/chat/changesets/${id}/apply`, { method: 'POST', body: JSON.stringify(body) }),
  discardChangeset: (id: string, body: { opIds?: string[] }) =>
    http<ChangesetResult>(`/api/chat/changesets/${id}/discard`, { method: 'POST', body: JSON.stringify(body) }),
  revertChangeset: (id: string) =>
    http<ChangesetResult>(`/api/chat/changesets/${id}/revert`, { method: 'POST' }),
};

/**
 * Watch a conversation: a `snapshot` of it as it stands, then every event of the turn
 * running in it, until `end`. Resolves when the stream closes. fetch + a reader rather
 * than EventSource, because EventSource can't send the Authorization header.
 */
export async function watchChat(
  threadId: string,
  onEvent: (event: ChatStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/threads/${threadId}/stream`, {
    headers: await authHeaders(),
    signal,
  });
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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      // Comment lines (": ping") keep the connection warm and carry nothing.
      if (!chunk.startsWith('data:')) continue;
      onEvent(JSON.parse(chunk.slice(5)) as ChatStreamEvent);
    }
  }
}
