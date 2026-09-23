import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHAT_EFFORTS, DEFAULT_CHAT_EFFORT, type ChatCommand, type ChatEffort, type ChatModel, type ChatView } from '../../../../shared/chat';
import { DOMAIN_LABELS } from '../../../../shared/types';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useChatThread, type ChatState } from '../../lib/chat';
import { useChatTabs, type ChatTab } from '../../lib/chatTabs';
import { useChatView } from '../../lib/chatView';
import { ChangesetCard } from './ChangesetReview';
import { AssistantTurn, UserTurn } from './Transcript';

// The Claude dock (manual.md): an orange circle, bottom-left, on every screen. Open it
// and you are talking to Claude with whatever you're looking at as context — a world, a
// dataset, one item — and no fixed menu of things you may ask. It is Claude Code's
// terminal, for data: say what you want, watch it read and think and propose, review the
// diff, accept, and keep talking. The manual controls everywhere else in the app are
// untouched: this is the main way in, not the only one.
//
// Two things the dock deliberately does NOT do:
//  - It never ends a conversation for you. Accepting a diff is a step in the
//    conversation, not the end of it; only closing the tab does that.
//  - It has no menu of "things Claude can do". What it has is `/` — saved prompts
//    (server/src/prompts/commands, one Markdown file each), the way Claude Code has
//    slash commands: a good thorough ask on file, so you don't retype it. Each is only
//    ever a prompt.
//
// No history: a conversation is a TAB (lib/chatTabs.ts), not an entry in a list you
// browse later. Several can be going at once — that's what tabs are for. Closing a tab
// deletes its thread.

const MODEL_KEY = 'tt:chat:model';
const EFFORT_KEY = 'tt:chat:effort';

const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* fine */ } };

function ClaudeMark({ className = '' }: { className?: string }) {
  // A plain eight-point spark — reads as "Claude" without borrowing the real logo.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

/** What the tab strip needs to know about a tab it isn't necessarily showing right
 *  now — each pane reports its own as it changes. */
interface TabStatus {
  title: string;
  running: boolean;
  pending: number;
  asking: boolean;
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  // Tabs only connect once the dock has been opened — a closed dock on every page
  // load shouldn't cost a request.
  const [everOpened, setEverOpened] = useState(false);
  const { view, request } = useChatView();
  const { email } = useAuth();
  const tabs = useChatTabs();
  const [statusByTab, setStatusByTab] = useState<Record<string, TabStatus>>({});
  const reportStatus = (key: string, status: TabStatus) =>
    setStatusByTab((prev) => (
      prev[key]?.title === status.title && prev[key]?.running === status.running && prev[key]?.pending === status.pending && prev[key]?.asking === status.asking
        ? prev
        : { ...prev, [key]: status }
    ));

  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState(() => stored(MODEL_KEY) ?? '');
  const [effort, setEffort] = useState<ChatEffort>(() => {
    const saved = stored(EFFORT_KEY);
    return CHAT_EFFORTS.some((e) => e.id === saved) ? (saved as ChatEffort) : DEFAULT_CHAT_EFFORT;
  });
  const [commands, setCommands] = useState<ChatCommand[]>([]);

  // Anything in the app can open the dock with a draft (lib/chatView.tsx's `ask`) — in
  // a fresh tab, so it never clobbers a conversation already going.
  useEffect(() => {
    if (!request.seq) return;
    setOpen(true);
    setEverOpened(true);
    tabs.newTab();
  }, [request]);
  const pendingDraft = request.draft;

  // The list is live from Claude via the Space; while Render or the Space is still waking
  // the API answers with a fallback (live: false), so keep asking until the real one lands.
  const [modelsLive, setModelsLive] = useState(false);
  useEffect(() => {
    if (!everOpened || modelsLive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (attempt: number) => {
      api.chatModels()
        .then(({ models: list, defaultModel, live }) => {
          if (cancelled) return;
          setModels(list);
          setModel((m) => (m && list.some((x) => x.id === m) ? m : defaultModel));
          if (live !== false) setModelsLive(true);
          else if (attempt < 6) timer = setTimeout(() => load(attempt + 1), 10_000);
        })
        .catch(() => { if (!cancelled && attempt < 6) timer = setTimeout(() => load(attempt + 1), 10_000); });
    };
    load(0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [everOpened, modelsLive]);

  useEffect(() => {
    if (!everOpened) return;
    api.chatCommands().then(setCommands).catch(() => {});
  }, [everOpened]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // The diff review owns Escape while it's up (it sits above the dock).
      if (e.key === 'Escape' && !document.querySelector('[data-changeset-review]')) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const needsSignIn = view.domain === 'personal' && !email;

  const running = Object.values(statusByTab).some((s) => s.running);
  const asking = Object.values(statusByTab).some((s) => s.asking);
  const pendingCount = Object.values(statusByTab).reduce((n, s) => n + s.pending, 0);

  function openDock() {
    setOpen(true);
    setEverOpened(true);
    if (!tabs.tabs.length) tabs.newTab();
  }

  function closeTabWithConfirm(tab: ChatTab) {
    const pending = statusByTab[tab.key]?.pending ?? 0;
    if (pending > 0 && !window.confirm(`Close this chat? ${pending} proposed change${pending === 1 ? '' : 's'} will be discarded.`)) return;
    tabs.closeTab(tab.key);
  }

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={openDock}
          data-chat-dock
          aria-label="Ask Claude"
          title="Ask Claude"
          className="fixed bottom-5 left-5 z-[55] grid place-items-center rounded-full bg-[var(--color-claude)] text-white shadow-lg transition-transform hover:scale-105"
          style={{ height: '3.25rem', width: '3.25rem' }}
        >
          <ClaudeMark className="h-6 w-6" />
          {(running || pendingCount > 0) && (
            <span className={`absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--color-ink)] px-1 text-[10px] font-medium text-white ${running && !asking ? 'animate-pulse' : ''}`}>
              {asking ? '?' : pendingCount > 0 ? pendingCount : '…'}
            </span>
          )}
        </button>
      )}

      {open && (
        <section
          data-chat-dock
          aria-label="Claude"
          className="fixed bottom-0 left-0 z-[55] flex h-[100dvh] w-full flex-col border-[var(--color-line)] bg-[var(--color-wall)] shadow-2xl sm:bottom-4 sm:left-4 sm:h-[min(46rem,calc(100dvh-2rem))] sm:w-[27rem] sm:rounded-xl sm:border"
        >
          <header className="flex items-center gap-1.5 border-b border-[var(--color-line)] px-2 pt-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--color-claude)] text-white"><ClaudeMark className="h-3 w-3" /></span>
            <div className="custom-scroll flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pb-0">
              {tabs.tabs.map((tab) => {
                const status = statusByTab[tab.key];
                const active = tab.key === tabs.activeKey;
                return (
                  <div
                    key={tab.key}
                    className={`group flex max-w-[9.5rem] shrink-0 items-center gap-1 rounded-t-md border border-b-0 px-2 py-1.5 text-xs ${
                      active
                        ? 'border-[var(--color-line)] bg-[var(--color-wall)]'
                        : 'border-transparent bg-transparent text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]'
                    }`}
                  >
                    <button type="button" onClick={() => tabs.activate(tab.key)} className="min-w-0 flex-1 truncate text-left">
                      {status?.asking && <span className="mr-1 text-[10px] font-semibold text-[var(--color-claude)]">?</span>}
                      {status?.running && !status.asking && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-claude)] align-middle animate-pulse" />}
                      {!status?.running && (status?.pending ?? 0) > 0 && (
                        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 align-middle" />
                      )}
                      {status?.title || 'New chat'}
                    </button>
                    <button
                      type="button"
                      aria-label="Close chat"
                      title="Close chat"
                      onClick={() => closeTabWithConfirm(tab)}
                      className="hidden h-4 w-4 shrink-0 rounded-full text-[13px] leading-none text-[var(--color-muted)] hover:bg-[var(--color-line)] group-hover:block"
                    >×</button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => tabs.newTab()}
                aria-label="New chat"
                title="New chat"
                className="mb-1 h-6 w-6 shrink-0 rounded text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
              >+</button>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="mb-1 h-7 w-7 shrink-0 rounded-full text-lg leading-none text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]">×</button>
          </header>

          {!tabs.tabs.length && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
              <button type="button" onClick={() => tabs.newTab()} className="rounded bg-[var(--color-claude)] px-3 py-1.5 text-xs font-medium text-white">New chat</button>
            </div>
          )}

          {tabs.tabs.map((tab) => (
            <ChatThreadPane
              key={tab.key}
              tab={tab}
              active={tab.key === tabs.activeKey}
              enabled={everOpened}
              view={view}
              model={model}
              effort={effort}
              needsSignIn={needsSignIn}
              initialDraft={tab.key === tabs.activeKey && pendingDraft ? pendingDraft : ''}
              onThreadId={(id) => tabs.setThreadId(tab.key, id)}
              onStatus={(status) => reportStatus(tab.key, status)}
              onModelChange={(m) => { setModel(m); store(MODEL_KEY, m); }}
              onEffortChange={(e) => { setEffort(e); store(EFFORT_KEY, e); }}
              models={models}
              commands={commands}
            />
          ))}
        </section>
      )}
    </>
  );
}

/** The `/` menu: which saved prompts match what's typed so far. Open only while the
 *  draft is a lone `/word` — once there's a space after the name, the user is writing
 *  arguments and the menu gets out of the way. */
function commandMenu(draft: string, commands: ChatCommand[]): ChatCommand[] {
  const m = draft.match(/^\/([a-z0-9-]*)$/i);
  if (!m) return [];
  const prefix = m[1].toLowerCase();
  return commands.filter((c) => c.name.startsWith(prefix));
}

function ChatThreadPane({
  tab, active, enabled, view, model, effort, needsSignIn, initialDraft,
  onThreadId, onStatus, onModelChange, onEffortChange, models, commands,
}: {
  tab: ChatTab;
  active: boolean;
  enabled: boolean;
  view: ChatView;
  model: string;
  effort: ChatEffort;
  needsSignIn: boolean;
  initialDraft: string;
  onThreadId: (id: string) => void;
  onStatus: (status: TabStatus) => void;
  onModelChange: (m: string) => void;
  onEffortChange: (e: ChatEffort) => void;
  models: ChatModel[];
  commands: ChatCommand[];
}) {
  const chat: ChatState = useChatThread(tab.threadId, enabled, onThreadId);
  const [draft, setDraft] = useState(initialDraft);
  const [dropped, setDropped] = useState<{ item?: boolean; dataset?: boolean }>({});
  const [menuIndex, setMenuIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    if (active) setTimeout(() => inputRef.current?.focus(), 50);
  }, [active]);

  // A different item or dataset is a different context: forget what was dropped.
  useEffect(() => setDropped({}), [view.datasetId, view.itemId]);

  const effectiveView = useMemo<ChatView>(() => {
    const v: ChatView = { ...view };
    if (dropped.item || dropped.dataset) { delete v.itemId; delete v.itemName; }
    if (dropped.dataset) { delete v.datasetId; delete v.datasetTopic; }
    return v;
  }, [view, dropped]);

  const messages = chat.thread?.messages ?? [];
  useLayoutEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  const pendingCount = chat.changesets.reduce(
    (n, c) => n + c.ops.filter((o) => o.status === 'pending' || o.status === 'conflict').length,
    0,
  );

  // Keep the tab strip (and the launcher badge) current even while this pane is
  // sitting in the background.
  useEffect(() => {
    onStatus({ title: chat.thread?.title || '', running: chat.running, pending: pendingCount, asking: !!chat.question });
  }, [chat.thread?.title, chat.running, pendingCount, chat.question]);

  // When Claude asks something, bring the input back to the front.
  useEffect(() => {
    if (chat.question && active) inputRef.current?.focus();
  }, [chat.question?.callId, active]);

  const menu = commandMenu(draft, commands);
  useEffect(() => setMenuIndex(0), [draft]);

  function pickCommand(c: ChatCommand) {
    setDraft(`/${c.name} `);
    inputRef.current?.focus();
  }

  function submit(text = draft) {
    const clean = text.trim();
    if (!clean || needsSignIn) return;
    stickRef.current = true;
    if (chat.question) {
      setDraft('');
      void chat.answer(clean);
      return;
    }
    if (chat.running) return;
    setDraft('');
    void chat.send(clean, effectiveView, { model: model || undefined, effort });
  }

  // Which message each changeset is drawn under: the LAST turn that staged into it, so
  // the card sits at the point in the conversation where it was most recently touched.
  const cardAfter = new Map<string, string>();
  for (const m of messages) for (const id of m.changesetIds ?? []) cardAfter.set(id, m.id);

  const chips = [
    effectiveView.domain && { key: 'domain', label: DOMAIN_LABELS[effectiveView.domain].short, drop: undefined },
    effectiveView.datasetTopic && { key: 'dataset', label: effectiveView.datasetTopic, drop: () => setDropped({ dataset: true }) },
    effectiveView.itemName && { key: 'item', label: effectiveView.itemName, drop: () => setDropped((d) => ({ ...d, item: true })) },
  ].filter(Boolean) as Array<{ key: string; label: string; drop?: () => void }>;

  const canSend = !!draft.trim() && !needsSignIn && (!chat.running || !!chat.question);
  const placeholder = chat.question
    ? 'Answer Claude…'
    : chat.running
      ? 'Claude is working… (Stop to interrupt)'
      : commands.length
        ? 'Ask, or ask for a change.  /  for saved prompts'
        : 'Ask, or ask for a change…';

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${active ? '' : 'hidden'}`}>
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="custom-scroll flex-1 space-y-4 overflow-y-auto px-3 py-3"
      >
        {messages.map((m) => (
          <div key={m.id} className="space-y-2">
            {m.role === 'user' ? <UserTurn message={m} /> : <AssistantTurn message={m} onAnswer={(text) => submit(text)} />}
            {chat.changesets
              .filter((c) => cardAfter.get(c.id) === m.id)
              .map((c) => <ChangesetCard key={c.id} changeset={c} decide={chat.decide} busy={chat.running} />)}
          </div>
        ))}
      </div>

      {chat.error && <p className="mx-3 mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{chat.error}</p>}

      <footer className="relative border-t border-[var(--color-line)] bg-[var(--color-card)] p-2.5 sm:rounded-b-xl">
        {menu.length > 0 && (
          <ul className="custom-scroll absolute bottom-full left-2.5 right-2.5 z-10 mb-1 max-h-64 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] py-1 shadow-lg">
            {menu.map((c, i) => (
              <li key={c.name}>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); pickCommand(c); }}
                  onMouseEnter={() => setMenuIndex(i)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs ${i === menuIndex ? 'bg-[var(--color-wall-soft)]' : ''}`}
                >
                  <span className="shrink-0 font-mono text-[var(--color-claude)]">/{c.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-muted)]">{c.description}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {chips.length > 0 && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-[11px]">
            <span className="text-[var(--color-muted)]">Looking at</span>
            {chips.map((c) => (
              <span key={c.key} className="inline-flex max-w-[11rem] items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-wall)] py-0.5 pl-2 pr-1">
                <span className="truncate">{c.label}</span>
                {c.drop ? (
                  <button type="button" onClick={c.drop} aria-label={`Leave ${c.label} out`} className="h-4 w-4 rounded-full leading-none text-[var(--color-muted)] hover:bg-[var(--color-line)]">×</button>
                ) : <span className="w-1" />}
              </span>
            ))}
          </div>
        )}
        {needsSignIn ? (
          <p className="px-1 py-2 text-xs text-[var(--color-muted)]">Sign in to use Claude in your personal world.</p>
        ) : (
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              const highlighted = menu[menuIndex] ?? menu[0];
              if (highlighted) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMenuIndex((i) => (i + 1) % menu.length); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); setMenuIndex((i) => (i - 1 + menu.length) % menu.length); return; }
                // Enter on a half-typed name completes it; on the full name it sends.
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && draft.trim() !== `/${highlighted.name}`)) {
                  e.preventDefault();
                  pickCommand(highlighted);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
            rows={Math.min(6, Math.max(2, draft.split('\n').length))}
            placeholder={placeholder}
            className={`w-full resize-none rounded-lg border bg-[var(--color-wall)] px-3 py-2 text-sm outline-none focus:border-[var(--color-claude)] ${chat.question ? 'border-[var(--color-claude)]/60' : 'border-[var(--color-line)]'}`}
          />
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value)}
            aria-label="Model"
            className="min-w-0 max-w-[11rem] truncate rounded border border-[var(--color-line)] bg-[var(--color-wall)] px-1.5 py-1 text-[11px]"
          >
            {!models.length && <option value={model}>{model || 'Default model'}</option>}
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select
            value={effort}
            onChange={(e) => onEffortChange(e.target.value as ChatEffort)}
            aria-label="Effort"
            title="Effort — how hard Claude thinks before answering"
            className="rounded border border-[var(--color-line)] bg-[var(--color-wall)] px-1.5 py-1 text-[11px]"
          >
            {CHAT_EFFORTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          <span className="flex-1" />
          {chat.running && (
            <button type="button" onClick={chat.stop} className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs">Stop</button>
          )}
          {(!chat.running || chat.question) && (
            <button type="button" onClick={() => submit()} disabled={!canSend} className="rounded bg-[var(--color-claude)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              {chat.question ? 'Answer' : 'Send'}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
