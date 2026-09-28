import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatThreadSummary } from '../../../shared/chat';
import { api } from './api';

// The set of open Claude tabs (components/chat/ChatDock.tsx).
//
// The set is the ACCOUNT's, not this browser's: every conversation that exists on the
// server is a tab, on every device the curator signs in on. Start a turn on the phone,
// close it, open the laptop hours later — the tab is there, with Claude's diff waiting
// to be reviewed. (Until 2026-09-28 the tab list lived in localStorage, so a job begun
// on one device was invisible on the next; the thread itself was always server-side.)
//
// Still deliberately NOT a history: there is no browsable list of past conversations.
// A thread exists only until its tab is closed, from any device — closing deletes it
// rather than leaving it to rot in the database "for later".
//
// What is local: a DRAFT tab (opened, nothing sent yet — the server knows nothing about
// it), and which tab is active. A draft that sends its first message becomes a server
// thread and keeps its React key, so the pane showing it doesn't remount mid-stream.

export interface ChatTab {
  /** Client-side identity — stable even before the server has minted a thread. */
  key: string;
  threadId: string | null;
  /** What the server last said about the thread; absent for a draft. */
  summary?: ChatThreadSummary;
}

const ACTIVE_KEY = 'tt:chat:activeTab';
/** While Claude is at work somewhere, ask again this often so a badge on a device that
 *  hasn't opened the dock flips from "working" to "n to review" on its own. */
const RUNNING_POLL_MS = 30_000;

function newKey(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export interface ChatTabs {
  tabs: ChatTab[];
  activeKey: string | null;
  /** The server's list has been fetched at least once this session. */
  loaded: boolean;
  activate: (key: string) => void;
  /** Opens a fresh, empty tab and makes it active. */
  newTab: () => void;
  /** Closes a tab and deletes its thread server-side, if it has one. */
  closeTab: (key: string) => void;
  /** Reports the thread a tab's first message minted. */
  setThreadId: (key: string, id: string) => void;
  /** Re-fetch the server's list now (after a decision, on focus, …). */
  refresh: () => void;
}

/** @param enabled — signed in. Signed out there are no tabs and nothing is fetched:
 *  the chat API is behind the wall (server/src/index.ts). */
export function useChatTabs(enabled: boolean): ChatTabs {
  // Tabs this device made: drafts (threadId null) and the threads they went on to mint.
  const [local, setLocal] = useState<ChatTab[]>([]);
  const [summaries, setSummaries] = useState<ChatThreadSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  });
  // Threads closed here whose DELETE may still be in flight — kept out of a refresh
  // that races it, so a closed tab doesn't flicker back.
  const closing = useRef(new Set<string>());

  const refresh = useCallback(() => {
    if (!enabled) return;
    api.chatThreads()
      .then((list) => {
        setSummaries(list.filter((s) => !closing.current.has(s.id)));
        setLoaded(true);
      })
      .catch(() => { /* Render waking, or offline — the last list stands */ });
  }, [enabled]);

  // Signed out: forget everything. Signed in: fetch now, again whenever this device
  // comes back to the foreground (the phone-then-laptop case), and on a slow tick while
  // Claude is working somewhere.
  useEffect(() => {
    if (!enabled) {
      setLocal([]);
      setSummaries([]);
      setLoaded(false);
      return;
    }
    refresh();
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh]);

  const anyRunning = summaries.some((s) => s.status === 'running' || s.status === 'queued');
  useEffect(() => {
    if (!enabled || !anyRunning) return;
    const timer = setInterval(refresh, RUNNING_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, anyRunning, refresh]);

  // The server's threads, oldest first, each keeping the key of the local tab that
  // minted it (if this device did); then this device's drafts, and any thread it has
  // just minted that the list hasn't caught up with yet.
  const tabs = useMemo<ChatTab[]>(() => {
    const out: ChatTab[] = [];
    const seen = new Set<string>();
    for (const s of summaries) {
      const mine = local.find((t) => t.threadId === s.id);
      out.push({ key: mine?.key ?? s.id, threadId: s.id, summary: s });
      seen.add(s.id);
    }
    for (const t of local) if (!t.threadId || !seen.has(t.threadId)) out.push(t);
    return out;
  }, [summaries, local]);

  // A remembered active tab that no longer exists (closed elsewhere) falls back to the
  // last one; nothing remembered falls back to the first.
  useEffect(() => {
    if (!tabs.length) return;
    if (!activeKey || !tabs.some((t) => t.key === activeKey)) setActiveKey(tabs[tabs.length - 1].key);
  }, [activeKey, tabs]);

  useEffect(() => {
    try {
      if (activeKey) localStorage.setItem(ACTIVE_KEY, activeKey);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch { /* fine */ }
  }, [activeKey]);

  const newTab = useCallback(() => {
    const key = newKey();
    setLocal((prev) => [...prev, { key, threadId: null }]);
    setActiveKey(key);
  }, []);

  const setThreadId = useCallback((key: string, id: string) => {
    setLocal((prev) => prev.map((t) => (t.key === key ? { ...t, threadId: id } : t)));
    refresh();
  }, [refresh]);

  const closeTab = useCallback((key: string) => {
    const tab = tabs.find((t) => t.key === key);
    if (!tab) return;
    const next = tabs.filter((t) => t.key !== key);
    setActiveKey((cur) => (cur === key ? (next[next.length - 1]?.key ?? null) : cur));
    setLocal((prev) => prev.filter((t) => t.key !== key));
    if (tab.threadId) {
      const id = tab.threadId;
      closing.current.add(id);
      setSummaries((prev) => prev.filter((s) => s.id !== id));
      api.deleteChatThread(id).catch(() => {}).finally(() => closing.current.delete(id));
    }
  }, [tabs]);

  return { tabs, activeKey, loaded, activate: setActiveKey, newTab, closeTab, setThreadId, refresh };
}
