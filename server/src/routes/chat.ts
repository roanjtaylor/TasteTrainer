import { Router, type NextFunction, type Request, type Response } from 'express';
import { fetch as undiciFetch } from 'undici';
import { CLAUDE_MODEL, HF_APP_SECRET, HF_BASE_URL } from '../config.ts';
import {
  deleteThread,
  getChangeset,
  getDataset,
  getThread,
  listChangesets,
  listThreads,
} from '../storage.ts';
import { isRunning, liveThread, startRun, stopRun, subscribe } from '../services/agentRun.ts';
import { applyChangeset, rejectOps, revertChangeset } from '../services/changesets.ts';
import { newId, now } from '../util.ts';
import { optionalDomain } from '../../../shared/types.ts';
import { CHAT_EFFORTS, isMapOp } from '../../../shared/chat.ts';
import type {
  Changeset,
  ChatEffort,
  ChatModel,
  ChatStreamEvent,
  ChatThread,
  ChatThreadSummary,
  ChatView,
} from '../../../shared/chat.ts';

// The Claude chat (plan/claude-agent.md). Mounted at /api/chat.
//
// Access follows the rest of the app (auth.ts): the physical and digital worlds are
// open, the personal world needs a signed-in user — for the conversation that was
// started there, and for any change that touches a personal dataset.
export const chatRouter = Router();

const PERSONAL_401 = { error: 'Sign in to use Claude in your personal world.' };

/** A turn that was running when the server restarted is still marked so in storage,
 *  and would spin forever. Nothing is running it now, so say what happened. */
function present(thread: ChatThread): ChatThread {
  if (isRunning(thread.id)) return liveThread(thread.id) ?? thread;
  for (const m of thread.messages) {
    if (m.status === 'running' || m.status === 'queued') {
      m.status = 'error';
      m.error = 'Interrupted — the server restarted while Claude was working. Anything already staged is kept.';
      for (const b of m.blocks) if (b.type === 'tool') b.done = true;
    }
  }
  return thread;
}

async function loadThread(req: Request, res: Response): Promise<ChatThread | null> {
  const thread = liveThread(req.params.id) ?? (await getThread(req.params.id));
  if (!thread) { res.status(404).json({ error: 'Conversation not found.' }); return null; }
  if (thread.domain === 'personal' && !req.user) { res.status(401).json(PERSONAL_401); return null; }
  return present(thread);
}

/** A changeset, its thread checked for access — and, signed out, refused outright if it
 *  reaches into a personal dataset from a conversation that started somewhere else. */
async function loadChangeset(req: Request, res: Response): Promise<Changeset | null> {
  const cs = await getChangeset(req.params.id);
  if (!cs) { res.status(404).json({ error: 'Changeset not found.' }); return null; }
  if (!req.user) {
    const thread = await getThread(cs.threadId);
    const ids = [...new Set(cs.ops.flatMap((o) => (isMapOp(o) ? [] : o.kind === 'item.move' ? [o.datasetId, o.toDatasetId] : [o.datasetId])))];
    const datasets = await Promise.all(ids.map((id) => getDataset(id)));
    const personal =
      thread?.domain === 'personal' ||
      datasets.some((d) => d?.domain === 'personal') ||
      cs.ops.some((o) => o.kind === 'dataset.create' && o.domain === 'personal');
    if (personal) { res.status(401).json(PERSONAL_401); return null; }
  }
  if (isRunning(cs.threadId)) {
    res.status(409).json({ error: 'Claude is still working — wait for it to finish, or stop it, before deciding.' });
    return null;
  }
  return cs;
}

// ---- Models ----

const FALLBACK_MODELS: ChatModel[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5' },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
];

// The Space asks Anthropic which models the subscription can use, so the picker keeps
// up with new releases on its own. Falls back to a fixed list rather than failing —
// the picker is a convenience, not a dependency.
chatRouter.get('/models', async (_req, res) => {
  let models = FALLBACK_MODELS;
  try {
    const r = await undiciFetch(`${HF_BASE_URL}/api/models`, {
      headers: { 'x-app-secret': HF_APP_SECRET },
      signal: AbortSignal.timeout(8000),
    });
    const body = (await r.json()) as { models?: Array<{ id?: string; name?: string; display_name?: string }> };
    const live = (body.models ?? [])
      .filter((m) => m?.id)
      .map((m) => ({ id: m.id as string, name: m.name ?? m.display_name ?? (m.id as string) }));
    if (live.length) models = live;
  } catch { /* fall back */ }
  res.set('Cache-Control', 'private, max-age=600');
  res.json({ models, defaultModel: CLAUDE_MODEL });
});

// ---- Threads ----

chatRouter.get('/threads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threads = (await listThreads()).filter((t) => req.user || t.domain !== 'personal').map(present);
    const summaries: ChatThreadSummary[] = threads.map((t) => ({
      id: t.id,
      domain: t.domain,
      title: t.title || 'New conversation',
      status: t.messages[t.messages.length - 1]?.status ?? 'done',
      updatedAt: t.updatedAt,
    }));
    res.set('Cache-Control', 'no-store');
    res.json(summaries);
  } catch (err) { next(err); }
});

chatRouter.get('/threads/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thread = await loadThread(req, res);
    if (!thread) return;
    res.set('Cache-Control', 'no-store');
    res.json({ thread, changesets: await listChangesets(thread.id), running: isRunning(thread.id) });
  } catch (err) { next(err); }
});

chatRouter.delete('/threads/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thread = await loadThread(req, res);
    if (!thread) return;
    stopRun(thread.id);
    await deleteThread(thread.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// Send a message. Creates the conversation on its first message, starts the turn in the
// background and returns at once — the reply is watched through /stream below, the same
// way for the tab that sent it as for one that opens the conversation later.
chatRouter.post('/messages', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { threadId, text, model, effort } = req.body as {
      threadId?: string;
      text?: string;
      model?: string;
      effort?: ChatEffort;
    };
    const raw = (req.body?.view ?? {}) as ChatView;
    const view: ChatView = { ...raw, domain: optionalDomain(raw.domain) };
    if (!text?.trim()) return res.status(400).json({ error: 'Say something first.' });
    if (view.domain === 'personal' && !req.user) return res.status(401).json(PERSONAL_401);

    let thread: ChatThread | null = null;
    if (threadId) {
      thread = await getThread(threadId);
      if (!thread) return res.status(404).json({ error: 'Conversation not found.' });
      if (thread.domain === 'personal' && !req.user) return res.status(401).json(PERSONAL_401);
      if (isRunning(thread.id)) return res.status(409).json({ error: 'Claude is still working in this conversation.' });
      present(thread);
    } else {
      thread = { id: newId(), domain: view.domain ?? null, title: '', messages: [], createdAt: now(), updatedAt: now() };
    }

    const started = await startRun({
      thread, text: text.trim(), view, model, personal: !!req.user,
      effort: CHAT_EFFORTS.some((e) => e.id === effort) ? effort : 'off',
    });
    res.status(202).json({ thread: started });
  } catch (err) { next(err); }
});

chatRouter.post('/threads/:id/stop', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thread = await loadThread(req, res);
    if (!thread) return;
    res.json({ stopped: stopRun(thread.id) });
  } catch (err) { next(err); }
});

// Watch a conversation: a snapshot of it as it stands (mid-turn included), then every
// event of the running turn as it happens, then `end`. With nothing running it is just
// snapshot + end, so the client never needs to know in advance which case it's in.
chatRouter.get('/threads/:id/stream', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thread = await loadThread(req, res);
    if (!thread) return;
    const changesets = await listChangesets(thread.id);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.on('error', () => {});
    const send = (event: ChatStreamEvent) => {
      if (res.writableEnded) return;
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch { /* the viewer left; the turn carries on without them */ }
      if (event.type === 'end') res.end();
    };

    // Snapshot and subscribe in the same tick: the live thread is mutated synchronously
    // by the run engine, so nothing can happen between the copy and the subscription.
    const live = liveThread(thread.id) ?? thread;
    send({ type: 'snapshot', thread: structuredClone(live), changesets });
    const unsubscribe = subscribe(thread.id, send);
    if (!unsubscribe) return send({ type: 'end' });

    const ping = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 20_000);
    res.on('close', () => { clearInterval(ping); unsubscribe(); });
  } catch (err) { next(err); }
});

// ---- Changesets ----

chatRouter.get('/changesets/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cs = await getChangeset(req.params.id);
    if (!cs) return res.status(404).json({ error: 'Changeset not found.' });
    res.set('Cache-Control', 'no-store');
    res.json(cs);
  } catch (err) { next(err); }
});

// Accept: the ONLY path by which anything Claude proposed reaches taste_datasets.
chatRouter.post('/changesets/:id/apply', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cs = await loadChangeset(req, res);
    if (!cs) return;
    const { opIds, force } = req.body as { opIds?: string[]; force?: boolean };
    res.json(await applyChangeset(cs.threadId, cs.id, { opIds, force: force === true }));
  } catch (err) { next(err); }
});

chatRouter.post('/changesets/:id/discard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cs = await loadChangeset(req, res);
    if (!cs) return;
    const { opIds } = req.body as { opIds?: string[] };
    res.json({ changeset: await rejectOps(cs.threadId, cs.id, opIds), updated: [], deletedTopics: [] });
  } catch (err) { next(err); }
});

chatRouter.post('/changesets/:id/revert', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cs = await loadChangeset(req, res);
    if (!cs) return;
    res.json(await revertChangeset(cs.threadId, cs.id));
  } catch (err) { next(err); }
});
