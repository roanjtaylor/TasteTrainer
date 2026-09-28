import { Router, type NextFunction, type Request, type Response } from 'express';
import { fetch as undiciFetch } from 'undici';
import { CLAUDE_MODEL, HF_APP_SECRET, HF_BASE_URL } from '../config.ts';
import {
  deleteThread,
  getChangeset,
  getThread,
  listChangesets,
  listOpenChangesets,
  listThreads,
} from '../storage.ts';
import { answerQuestion, isRunning, liveThread, startRun, stopRun, subscribe } from '../services/agentRun.ts';
import { applyChangeset, rejectOps, revertChangeset } from '../services/changesets.ts';
import { expandCommand, listCommands } from '../services/commands.ts';
import { newId, now } from '../util.ts';
import { optionalDomain } from '../../../shared/types.ts';
import { CHAT_EFFORTS, DEFAULT_CHAT_EFFORT } from '../../../shared/chat.ts';
import type {
  Changeset,
  ChatEffort,
  ChatModel,
  ChatStreamEvent,
  ChatThread,
  ChatThreadSummary,
  ChatView,
} from '../../../shared/chat.ts';

// The Claude chat (manual.md). Mounted at /api/chat, behind `requireAuth` (index.ts):
// every route here has a signed-in, allowlisted curator on `req.user`. Claude is the
// curator's tool for changing the data; a visitor's only voice is "Report a problem" on
// an item, which is read from the table, not from here.
//
// Conversations belong to the ACCOUNT, not the browser. The thread list below is what
// every device draws its tabs from, so a turn started on a phone is waiting, with its
// diff, on the laptop opened hours later.
export const chatRouter = Router();

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
  return present(thread);
}

/** Deciding while Claude is still working is fine — the same as accepting an edit in
 *  Claude Code before it has finished the next one. Staging and deciding both go
 *  through the changeset's per-thread lock (services/changesets.ts), and proposals are
 *  validated against the data as it stands plus what is still pending, so an accepted
 *  op simply becomes part of "as it stands". */
async function loadChangeset(req: Request, res: Response): Promise<Changeset | null> {
  const cs = await getChangeset(req.params.id);
  if (!cs) { res.status(404).json({ error: 'Changeset not found.' }); return null; }
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
  let live = false;
  try {
    const r = await undiciFetch(`${HF_BASE_URL}/api/models`, {
      headers: { 'x-app-secret': HF_APP_SECRET },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Space /api/models answered ${r.status}${HF_APP_SECRET ? '' : ' (HF_APP_SECRET is not set)'}`);
    // The Space names each model's display text `label`.
    const body = (await r.json()) as { models?: Array<{ id?: string; label?: string; name?: string; display_name?: string }> };
    const list = (body.models ?? [])
      .filter((m) => m?.id)
      .map((m) => ({ id: m.id as string, name: m.label ?? m.name ?? m.display_name ?? (m.id as string) }));
    if (list.length) { models = list; live = true; }
  } catch (err) {
    console.warn('[chat] live model list unavailable, using fallback:', err instanceof Error ? err.message : err);
  }
  // A fallback answer must not be cached, or one cold start pins the list for ten minutes.
  res.set('Cache-Control', live ? 'private, max-age=600' : 'no-store');
  res.json({ models, defaultModel: CLAUDE_MODEL, live });
});

// ---- Saved prompts ----

// The slash commands the dock offers (services/commands.ts). Names and descriptions
// only — the prompt text is the server's business, expanded when a message is sent.
chatRouter.get('/commands', async (_req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await listCommands());
  } catch (err) { next(err); }
});

// ---- Threads ----

// Every open conversation, oldest first — the dock's tab strip, on whichever device
// asks. Each carries what a tab shows without being opened: whether Claude is at work
// in it, and how many proposed changes are waiting on a decision.
chatRouter.get('/threads', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [threads, open] = await Promise.all([listThreads(), listOpenChangesets()]);
    const pendingByThread = new Map<string, number>();
    for (const cs of open) {
      const n = cs.ops.filter((o) => o.status === 'pending' || o.status === 'conflict').length;
      pendingByThread.set(cs.threadId, (pendingByThread.get(cs.threadId) ?? 0) + n);
    }
    const summaries: ChatThreadSummary[] = threads
      .map(present)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((t) => ({
        id: t.id,
        domain: t.domain,
        title: t.title || '',
        status: t.messages[t.messages.length - 1]?.status ?? 'done',
        pending: pendingByThread.get(t.id) ?? 0,
        createdAt: t.createdAt,
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

    let thread: ChatThread | null = null;
    if (threadId) {
      thread = await getThread(threadId);
      if (!thread) return res.status(404).json({ error: 'Conversation not found.' });
      if (isRunning(thread.id)) return res.status(409).json({ error: 'Claude is still working in this conversation.' });
      present(thread);
    } else {
      thread = { id: newId(), domain: view.domain ?? null, title: '', messages: [], createdAt: now(), updatedAt: now() };
    }

    // `personal: true` — only the signed-in curator gets this far (requireAuth), so the
    // personal world is theirs to read and change like the other two.
    const started = await startRun({
      thread, text: text.trim(), prompt: (await expandCommand(text)) ?? undefined, view, model, personal: true,
      effort: CHAT_EFFORTS.some((e) => e.id === effort) ? effort : DEFAULT_CHAT_EFFORT,
    });
    res.status(202).json({ thread: started });
  } catch (err) { next(err); }
});

// Answer the question Claude is waiting on (the ask_user tool). The turn then resumes
// on its own; the answer shows up in the stream as that tool call's result.
chatRouter.post('/threads/:id/answer', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const thread = await loadThread(req, res);
    if (!thread) return;
    const { callId, text } = req.body as { callId?: string; text?: string };
    if (!callId || !text?.trim()) return res.status(400).json({ error: 'An answer needs a callId and some text.' });
    if (!answerQuestion(thread.id, callId, text.trim())) {
      return res.status(409).json({ error: 'Claude is not waiting on that question any more.' });
    }
    res.json({ ok: true });
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
    const cs = await loadChangeset(req, res);
    if (!cs) return;
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
