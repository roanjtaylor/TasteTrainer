import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

// The set of open Claude tabs (components/chat/ChatDock.tsx). Deliberately NOT a
// history: there is no browsable list of past conversations anywhere in the app.
// A tab exists only while it's either still going (a turn running, or a changeset
// still waiting on a decision) or the user hasn't closed it yet — closing a tab, and
// a changeset resolving with nothing left open, both delete the underlying thread
// (lib/chat.ts talks to it) rather than leaving it to rot in the database "for later".

export interface ChatTab {
  /** Client-side identity — stable even before the server has minted a thread. */
  key: string;
  threadId: string | null;
}

const TABS_KEY = 'tt:chat:tabs';
const ACTIVE_KEY = 'tt:chat:activeTab';

function newKey(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadTabs(): ChatTab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is ChatTab => !!t && typeof t.key === 'string' && typeof t.threadId === 'string');
    }
  } catch { /* ignore */ }
  return [];
}

function persist(tabs: ChatTab[], active: string | null): void {
  try {
    // Only threads that actually exist server-side are worth restoring — an empty,
    // never-sent draft tab left open across a refresh would just reappear blank.
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs.filter((t) => t.threadId)));
    if (active) localStorage.setItem(ACTIVE_KEY, active);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* storage blocked — tabs just won't survive a reload */ }
}

export interface ChatTabs {
  tabs: ChatTab[];
  activeKey: string | null;
  activate: (key: string) => void;
  /** Opens a fresh, empty tab and makes it active. */
  newTab: () => void;
  /** Closes a tab and deletes its thread server-side, if it has one. */
  closeTab: (key: string) => void;
  /** Reports the thread a tab's first message minted. */
  setThreadId: (key: string, id: string) => void;
}

export function useChatTabs(): ChatTabs {
  const [tabs, setTabs] = useState<ChatTab[]>(() => loadTabs());
  const [activeKey, setActiveKey] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  });

  // A restored set of tabs with no remembered active one just falls back to the first.
  useEffect(() => {
    if (!activeKey && tabs.length) setActiveKey(tabs[0].key);
  }, [activeKey, tabs]);

  useEffect(() => { persist(tabs, activeKey); }, [tabs, activeKey]);

  const newTab = useCallback(() => {
    const key = newKey();
    setTabs((prev) => [...prev, { key, threadId: null }]);
    setActiveKey(key);
  }, []);

  const setThreadId = useCallback((key: string, id: string) => {
    setTabs((prev) => prev.map((t) => (t.key === key ? { ...t, threadId: id } : t)));
  }, []);

  const closeTab = useCallback((key: string) => {
    setTabs((prev) => {
      const closed = prev.find((t) => t.key === key);
      if (closed?.threadId) api.deleteChatThread(closed.threadId).catch(() => {});
      const next = prev.filter((t) => t.key !== key);
      setActiveKey((cur) => (cur === key ? (next[next.length - 1]?.key ?? null) : cur));
      return next;
    });
  }, []);

  return { tabs, activeKey, activate: setActiveKey, newTab, closeTab, setThreadId };
}
