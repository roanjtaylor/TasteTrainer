import type {
  Dataset,
  Domain,
  ImageCandidate,
  ImageKind,
  Item,
  LikedTweetRef,
  Subtopic,
  TweetImportStats,
  ProposedItem,
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

// The server's side of the app: only what needs a server — the Claude agent, image
// sourcing, tweet import, uploads, and the hand-made dataset writes. Reading is not
// on this list: every read goes straight to Supabase (lib/db.ts), so a page view
// never has to wake the Render free tier from its spin-down.
//
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

/** A failed request, with the status kept. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
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
    throw new HttpError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** One line of live status from a streaming call, for a notification card to show. */
export type OnProgress = (line: string) => void;

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
  // Datasets — the hand-made writes (the personal world's own editor). Reads are
  // lib/db.ts.
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

  // The Claude chat (server/src/routes/chat.ts). Sending returns as soon as the turn
  // has STARTED; the reply is watched with `watchChat` below.
  chatModels: () => http<{ models: ChatModel[]; defaultModel: string; live?: boolean }>('/api/chat/models'),
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
