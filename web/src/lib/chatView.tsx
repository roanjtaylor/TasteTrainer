import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ChatView } from '../../../shared/chat';
import { useDomain } from './domain';

// What Claude is told you're looking at (shared/chat.ts's ChatView).
//
// The world comes from the URL, so it needs no help. The dataset and the open item
// are only known to the screens that own them, so those screens
// REPORT them here (`useReportChatView`) and the chat dock reads the result. A screen
// reports for as long as it's mounted and withdraws what it said when it leaves — so
// the dock can never go on claiming you're looking at a dataset you've navigated away
// from.
//
// It also carries `ask`: a way for any button in the app to open the dock with a
// message ready ("Ask Claude about this item"), without knowing anything about the dock.

type Reported = Omit<ChatView, 'domain'>;

interface ChatViewContextValue {
  view: ChatView;
  report: (part: Reported) => void;
  withdraw: (keys: Array<keyof Reported>) => void;
  /** A request to open the dock, optionally with a draft. Bumps `seq` so the same
   *  draft asked for twice still opens it twice. */
  request: { seq: number; draft: string };
  ask: (draft?: string) => void;
}

const ChatViewContext = createContext<ChatViewContextValue>({
  view: {},
  report: () => {},
  withdraw: () => {},
  request: { seq: 0, draft: '' },
  ask: () => {},
});

export function ChatViewProvider({ children }: { children: ReactNode }) {
  const domain = useDomain();
  const [reported, setReported] = useState<Reported>({});
  const [request, setRequest] = useState({ seq: 0, draft: '' });

  const report = useCallback((part: Reported) => setReported((prev) => ({ ...prev, ...part })), []);
  const withdraw = useCallback((keys: Array<keyof Reported>) => {
    setReported((prev) => {
      const next = { ...prev };
      for (const key of keys) delete next[key];
      return next;
    });
  }, []);
  const ask = useCallback((draft = '') => setRequest((r) => ({ seq: r.seq + 1, draft })), []);

  const value = useMemo(
    () => ({ view: { ...reported, domain: domain ?? undefined }, report, withdraw, request, ask }),
    [reported, domain, report, withdraw, request, ask],
  );
  return <ChatViewContext.Provider value={value}>{children}</ChatViewContext.Provider>;
}

export function useChatView(): ChatViewContextValue {
  return useContext(ChatViewContext);
}

/**
 * Report part of the current view for as long as the calling component is mounted.
 * Pass `undefined` values freely — e.g. `itemId: open?.id` — they're reported as absent.
 */
export function useReportChatView(part: Reported): void {
  const { report, withdraw } = useContext(ChatViewContext);
  // Keyed on content, not identity: callers build this object inline every render.
  const key = JSON.stringify(part);
  useEffect(() => {
    const parsed = JSON.parse(key) as Reported;
    report(parsed);
    return () => withdraw(Object.keys(parsed) as Array<keyof Reported>);
  }, [key, report, withdraw]);
}
