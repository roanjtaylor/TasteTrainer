import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CHAT_EFFORTS, type ChatEffort, type ChatModel, type ChatThreadSummary, type ChatView } from '../../../../shared/chat';
import { DOMAIN_LABELS } from '../../../../shared/types';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useChat } from '../../lib/chat';
import { useChatView } from '../../lib/chatView';
import { ChangesetCard } from './ChangesetReview';
import { AssistantTurn, UserTurn } from './Transcript';

// The Claude dock (plan/claude-agent.md): an orange circle, bottom-left, on every
// screen. Open it and you are talking to Claude with whatever you're looking at as
// context — a world, a dataset, one item — and no fixed menu of things you may ask.
// Questions get answers; requests to change things come back as a diff to accept
// (ChangesetReview.tsx). The manual controls everywhere else in the app are untouched:
// this is the main way in, not the only one.

const MODEL_KEY = 'tt:chat:model';
const EFFORT_KEY = 'tt:chat:effort';

const stored = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* fine */ } };

/** The world-level asks, shared with the shelf's own buttons (pages/Home.tsx). */
export const WORLD_PROMPTS = {
  draw: 'Draw the map of this world: choose the two axes and the regions, place every dataset, and mark the fields I’m missing.',
  review:
    'Review this world: is the map still right, which fields am I missing (favour the ones I wouldn’t think of), and which datasets should be merged, split or renamed? Propose the changes.',
  fields: 'Which fields make up this world? Propose the datasets I should start with, then draw its map.',
};

/** Starting points, chosen by what's on screen. Plain prompts — each does nothing a
 *  typed message couldn't, which is the point: they replace the old fixed Review
 *  buttons with text you can read, send as-is, or edit first. */
function presetsFor(view: ChatView): string[] {
  if (view.itemId) {
    return [
      'Tell me more about this — what should I be looking at?',
      'Check this item’s facts: year, maker, and the defining fact.',
      'What else here is most like this, and what is its opposite?',
    ];
  }
  if (view.datasetId) {
    return [
      'What is this dataset missing? Sweep the whole field, then tell me the gaps.',
      'Expand this with 10 defining items it doesn’t have yet.',
      'Check the years and makers for mistakes and propose fixes.',
      'Fill in any thin or missing descriptions.',
    ];
  }
  if (view.domain === 'personal') return ['Which of my datasets look thin or lopsided?'];
  if (view.domain) {
    return [
      WORLD_PROMPTS.review,
      WORLD_PROMPTS.draw,
      'Which of my datasets look thin or lopsided?',
    ];
  }
  return ['What can you do here?'];
}

function ClaudeMark({ className = '' }: { className?: string }) {
  // A plain eight-point spark — reads as "Claude" without borrowing the real logo.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" />
    </svg>
  );
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  // The conversation only connects once the dock has been opened — a closed dock on
  // every page load shouldn't cost a request.
  const [everOpened, setEverOpened] = useState(false);
  const { view, request } = useChatView();
  const { email } = useAuth();
  const chat = useChat(everOpened);

  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<ChatModel[]>([]);
  const [model, setModel] = useState(() => stored(MODEL_KEY) ?? '');
  const [effort, setEffort] = useState<ChatEffort>(() => {
    const saved = stored(EFFORT_KEY);
    return CHAT_EFFORTS.some((e) => e.id === saved) ? (saved as ChatEffort) : 'off';
  });
  const [history, setHistory] = useState<ChatThreadSummary[] | null>(null);
  // Levels of the view the user has chosen to leave out of THIS message's context.
  const [dropped, setDropped] = useState<{ item?: boolean; dataset?: boolean }>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // Anything in the app can open the dock with a draft (lib/chatView.tsx's `ask`).
  useEffect(() => {
    if (!request.seq) return;
    setOpen(true);
    setEverOpened(true);
    if (request.draft) setDraft(request.draft);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [request]);

  useEffect(() => {
    if (!everOpened || models.length) return;
    api.chatModels()
      .then(({ models: list, defaultModel }) => {
        setModels(list);
        setModel((m) => (m && list.some((x) => x.id === m) ? m : defaultModel));
      })
      .catch(() => {});
  }, [everOpened, models.length]);

  // A different item or dataset is a different context: forget what was dropped.
  useEffect(() => setDropped({}), [view.datasetId, view.itemId]);

  const effectiveView = useMemo<ChatView>(() => {
    const v: ChatView = { ...view };
    if (dropped.item || dropped.dataset) { delete v.itemId; delete v.itemName; }
    if (dropped.dataset) { delete v.datasetId; delete v.datasetTopic; }
    return v;
  }, [view, dropped]);

  // Follow the reply down as it streams — unless the user has scrolled up to read.
  const messages = chat.thread?.messages ?? [];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

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

  function submit(text = draft) {
    const clean = text.trim();
    if (!clean || chat.running || needsSignIn) return;
    stickRef.current = true;
    setDraft('');
    void chat.send(clean, effectiveView, { model: model || undefined, effort });
  }

  function toggleHistory() {
    if (history) return setHistory(null);
    setHistory([]);
    api.chatThreads().then(setHistory).catch(() => setHistory([]));
  }

  // Which message each changeset is drawn under: the LAST turn that staged into it, so
  // the card sits at the point in the conversation where it was most recently touched.
  // Not memoised: `messages` is mutated in place while streaming, so there is no
  // dependency that reliably says "a turn just staged into this changeset".
  const cardAfter = new Map<string, string>();
  for (const m of messages) if (m.changesetId) cardAfter.set(m.changesetId, m.id);

  const pendingCount = chat.changesets.reduce(
    (n, c) => n + c.ops.filter((o) => o.status === 'pending' || o.status === 'conflict').length,
    0,
  );

  const chips = [
    effectiveView.domain && { key: 'domain', label: DOMAIN_LABELS[effectiveView.domain].short, drop: undefined },
    effectiveView.datasetTopic && { key: 'dataset', label: effectiveView.datasetTopic, drop: () => setDropped({ dataset: true }) },
    effectiveView.itemName && { key: 'item', label: effectiveView.itemName, drop: () => setDropped((d) => ({ ...d, item: true })) },
  ].filter(Boolean) as Array<{ key: string; label: string; drop?: () => void }>;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); setEverOpened(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          data-chat-dock
          aria-label="Ask Claude"
          title="Ask Claude"
          className="fixed bottom-5 left-5 z-[55] grid place-items-center rounded-full bg-[var(--color-claude)] text-white shadow-lg transition-transform hover:scale-105"
          style={{ height: '3.25rem', width: '3.25rem' }}
        >
          <ClaudeMark className="h-6 w-6" />
          {(chat.running || pendingCount > 0) && (
            <span className={`absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--color-ink)] px-1 text-[10px] font-medium text-white ${chat.running ? 'animate-pulse' : ''}`}>
              {chat.running ? '…' : pendingCount}
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
          <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--color-claude)] text-white"><ClaudeMark className="h-3.5 w-3.5" /></span>
            <h2 className="serif min-w-0 flex-1 truncate text-base">{chat.thread?.title || 'Claude'}</h2>
            <button type="button" onClick={toggleHistory} className="rounded px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]">History</button>
            <button type="button" onClick={() => { chat.newThread(); setHistory(null); inputRef.current?.focus(); }} className="rounded px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]">New</button>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="h-7 w-7 rounded-full text-lg leading-none text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]">×</button>
          </header>

          {history ? (
            <div className="custom-scroll flex-1 overflow-y-auto p-2">
              {!history.length && <p className="p-3 text-xs text-[var(--color-muted)]">No conversations yet.</p>}
              {history.map((t) => (
                <div key={t.id} className="group flex items-center gap-1 rounded hover:bg-[var(--color-wall-soft)]">
                  <button type="button" onClick={() => { chat.openThread(t.id); setHistory(null); }} className="min-w-0 flex-1 px-2.5 py-2 text-left">
                    <span className="block truncate text-sm">{t.title}</span>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
                      {t.domain ? DOMAIN_LABELS[t.domain].short : 'Anywhere'} · {new Date(t.updatedAt).toLocaleDateString()}
                      {(t.status === 'running' || t.status === 'queued') && ' · working…'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete conversation"
                    onClick={async () => {
                      await api.deleteChatThread(t.id).catch(() => {});
                      if (chat.thread?.id === t.id) chat.newThread();
                      setHistory((h) => (h ?? []).filter((x) => x.id !== t.id));
                    }}
                    className="mr-1 hidden h-6 w-6 rounded-full text-sm text-[var(--color-muted)] hover:bg-[var(--color-line)] group-hover:block"
                  >×</button>
                </div>
              ))}
            </div>
          ) : (
            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
              }}
              className="custom-scroll flex-1 space-y-4 overflow-y-auto px-3 py-3"
            >
              {!messages.length && (
                <div className="px-1 pt-2">
                  <p className="serif text-lg leading-snug">Ask anything, or ask for anything.</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">
                    Claude can see what you’re looking at and read all your data. Anything it wants to change comes back as a diff for you to accept — nothing is saved without you.
                  </p>
                  <div className="mt-3 space-y-1.5">
                    {presetsFor(effectiveView).map((p) => (
                      <button key={p} type="button" disabled={needsSignIn} onClick={() => submit(p)} className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2 text-left text-xs leading-snug hover:border-[var(--color-claude)] disabled:opacity-40">
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {m.role === 'user' ? <UserTurn message={m} /> : <AssistantTurn message={m} />}
                  {chat.changesets
                    .filter((c) => cardAfter.get(c.id) === m.id)
                    .map((c) => <ChangesetCard key={c.id} changeset={c} decide={chat.decide} busy={chat.running} />)}
                </div>
              ))}
            </div>
          )}

          {chat.error && <p className="mx-3 mb-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{chat.error}</p>}

          <footer className="border-t border-[var(--color-line)] bg-[var(--color-card)] p-2.5 sm:rounded-b-xl">
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
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                rows={Math.min(6, Math.max(2, draft.split('\n').length))}
                placeholder={chat.running ? 'Claude is working…' : 'Ask about this, or ask for a change…'}
                className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm outline-none focus:border-[var(--color-claude)]"
              />
            )}
            <div className="mt-1.5 flex items-center gap-2">
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); store(MODEL_KEY, e.target.value); }}
                aria-label="Model"
                className="min-w-0 max-w-[11rem] truncate rounded border border-[var(--color-line)] bg-[var(--color-wall)] px-1.5 py-1 text-[11px]"
              >
                {!models.length && <option value={model}>{model || 'Default model'}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              <select
                value={effort}
                onChange={(e) => { setEffort(e.target.value as ChatEffort); store(EFFORT_KEY, e.target.value); }}
                aria-label="Effort"
                title="How hard Claude thinks before answering — its reasoning is shown as it happens"
                className="rounded border border-[var(--color-line)] bg-[var(--color-wall)] px-1.5 py-1 text-[11px]"
              >
                {CHAT_EFFORTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
              <span className="flex-1" />
              {chat.running ? (
                <button type="button" onClick={chat.stop} className="rounded border border-[var(--color-line)] px-3 py-1.5 text-xs">Stop</button>
              ) : (
                <button type="button" onClick={() => submit()} disabled={!draft.trim() || needsSignIn} className="rounded bg-[var(--color-claude)] px-4 py-1.5 text-xs font-medium text-white disabled:opacity-40">Send</button>
              )}
            </div>
          </footer>
        </section>
      )}
    </>
  );
}
