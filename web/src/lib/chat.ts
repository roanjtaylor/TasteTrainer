import { useCallback, useEffect, useRef, useState } from 'react';
import { slugifyTopic } from '../../../shared/types';
import {
  reduceMessage,
  type Changeset,
  type ChangesetResult,
  type ChatEffort,
  type ChatStreamEvent,
  type ChatThread,
  type ChatView,
} from '../../../shared/chat';
import { api, watchChat } from './api';
import { publishDataset, publishWorldMap } from './data';
import { cacheKeys, drop } from './store';

// The chat dock's state (components/chat/ChatDock.tsx).
//
// A conversation is owned by the SERVER, not this tab: sending only starts a turn, and
// everything after that — this tab's own reply included — arrives by watching the
// thread's stream. That's what makes the three cases one case: a reply you're watching
// live, one you come back to after a refresh, and one another device started all go
// through `snapshot, then events, then end`.

const LAST_THREAD_KEY = 'tt:chat:thread';

/** After a decision, publish exactly what the server says changed, so every screen
 *  showing those datasets updates at once without refetching (lib/data.ts). */
function publishResult(result: ChangesetResult): void {
  for (const ds of result.updated) publishDataset(ds);
  for (const topic of result.deletedTopics) drop(cacheKeys.dataset(slugifyTopic(topic)));
  if (result.updated.length || result.deletedTopics.length) drop(cacheKeys.datasetListPrefix, { prefix: true });
  for (const map of result.maps ?? []) publishWorldMap(map.domain, map);
}

export interface ChatState {
  thread: ChatThread | null;
  changesets: Changeset[];
  /** A turn is queued or running in this conversation. */
  running: boolean;
  error: string;
  send: (text: string, view: ChatView, opts: { model?: string; effort?: ChatEffort }) => Promise<void>;
  stop: () => void;
  newThread: () => void;
  openThread: (id: string) => void;
  decide: (
    changesetId: string,
    action: 'apply' | 'discard' | 'revert',
    body?: { opIds?: string[]; force?: boolean },
  ) => Promise<void>;
}

export function useChat(enabled: boolean): ChatState {
  const [threadId, setThreadId] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_THREAD_KEY); } catch { return null; }
  });
  // Bumped to re-open the stream on the SAME thread (a follow-up message).
  const [watchSeq, setWatchSeq] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  // The thread is mutated in place by the shared reducer as events arrive — dozens a
  // second while text streams — and React is told at most once per frame.
  const threadRef = useRef<ChatThread | null>(null);
  const changesetsRef = useRef<Changeset[]>([]);
  const [, setFrame] = useState(0);
  const frameRef = useRef(0);
  const paint = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setFrame((n) => n + 1);
    });
  }, []);

  const upsertChangeset = useCallback((cs: Changeset) => {
    const list = changesetsRef.current;
    const i = list.findIndex((c) => c.id === cs.id);
    changesetsRef.current = i === -1 ? [...list, cs] : list.map((c) => (c.id === cs.id ? cs : c));
    paint();
  }, [paint]);

  useEffect(() => {
    try {
      if (threadId) localStorage.setItem(LAST_THREAD_KEY, threadId);
      else localStorage.removeItem(LAST_THREAD_KEY);
    } catch { /* storage blocked — the dock just won't remember across reloads */ }
  }, [threadId]);

  // The watcher. Only while the dock has been opened at least once (`enabled`): a
  // closed dock on every page load shouldn't hold a connection open.
  useEffect(() => {
    if (!enabled || !threadId) return;
    const controller = new AbortController();

    const onEvent = (event: ChatStreamEvent) => {
      if (event.type === 'snapshot') {
        threadRef.current = event.thread;
        changesetsRef.current = event.changesets;
        const last = event.thread.messages[event.thread.messages.length - 1];
        setRunning(last?.status === 'running' || last?.status === 'queued');
      } else if (event.type === 'changeset') {
        upsertChangeset(event.changeset);
        // Staging only happens during a turn, and the turn is always the last message.
        const messages = threadRef.current?.messages ?? [];
        const m = messages[messages.length - 1];
        if (m?.role === 'assistant' && m.status !== 'done') m.changesetId = event.changeset.id;
      } else if (event.type === 'end') {
        setRunning(false);
      } else {
        const m = threadRef.current?.messages.find((x) => x.id === event.messageId);
        if (m) reduceMessage(m, event);
        if (event.type === 'status') setRunning(event.status === 'running' || event.status === 'queued');
      }
      paint();
    };

    watchChat(threadId, onEvent, controller.signal).catch((e: any) => {
      if (controller.signal.aborted) return;
      // A thread that no longer exists (deleted elsewhere) just resets the dock.
      if (/not found/i.test(e?.message ?? '')) {
        threadRef.current = null;
        setThreadId(null);
      } else {
        setError(e?.message ?? 'Lost the connection to the conversation.');
      }
      setRunning(false);
    });
    return () => controller.abort();
  }, [enabled, threadId, watchSeq, paint, upsertChangeset]);

  // Pictures for proposed items are found AFTER the turn ends (the turn doesn't wait on
  // Wikimedia), when there's no stream left to carry them — so poll while any are due.
  const pendingImages = changesetsRef.current.some((c) => c.ops.some((o) => o.kind === 'item.add' && o.imagePending));
  useEffect(() => {
    if (running || !pendingImages) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries += 1;
      const waiting = changesetsRef.current.filter((c) => c.ops.some((o) => o.kind === 'item.add' && o.imagePending));
      if (!waiting.length || tries > 40) return clearInterval(timer);
      for (const cs of waiting) {
        try { upsertChangeset(await api.getChangeset(cs.id)); } catch { /* next tick */ }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [running, pendingImages, upsertChangeset]);

  const send = useCallback<ChatState['send']>(async (text, view, opts) => {
    setError('');
    try {
      const { thread } = await api.sendChat({ threadId: threadId ?? undefined, text, view, ...opts });
      threadRef.current = thread;
      setRunning(true);
      setThreadId(thread.id);
      setWatchSeq((n) => n + 1);
      paint();
    } catch (e: any) {
      setError(e?.message ?? 'Could not send.');
    }
  }, [threadId, paint]);

  const stop = useCallback(() => {
    if (threadId) api.stopChat(threadId).catch(() => {});
  }, [threadId]);

  const newThread = useCallback(() => {
    threadRef.current = null;
    changesetsRef.current = [];
    setRunning(false);
    setError('');
    setThreadId(null);
  }, []);

  const openThread = useCallback((id: string) => {
    threadRef.current = null;
    changesetsRef.current = [];
    setError('');
    setThreadId(id);
    setWatchSeq((n) => n + 1);
  }, []);

  const decide = useCallback<ChatState['decide']>(async (changesetId, action, body = {}) => {
    setError('');
    try {
      const result =
        action === 'apply'
          ? await api.applyChangeset(changesetId, body)
          : action === 'discard'
            ? await api.discardChangeset(changesetId, body)
            : await api.revertChangeset(changesetId);
      upsertChangeset(result.changeset);
      publishResult(result);
    } catch (e: any) {
      setError(e?.message ?? 'That didn’t go through.');
    }
  }, [upsertChangeset]);

  return {
    thread: threadRef.current,
    changesets: changesetsRef.current,
    running,
    error,
    send,
    stop,
    newThread,
    openThread,
    decide,
  };
}
