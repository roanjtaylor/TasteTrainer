import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EMBED_CONFIG_MESSAGE, EMBED_MODE_MESSAGE, EMBED_READY_MESSAGE } from '../lib/embedProtocol';
import { DOMAINS, DOMAIN_LABELS, slugifyTopic } from '../../../shared/types';
import type { DatasetSummary, Domain, EmbedDataset, EmbedItem } from '../../../shared/types';
import * as db from '../lib/db';
import { Misconfigured, SignIn, useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { thumbSrcSet } from '../lib/image';
import { Photo } from '../components/Photo';
import { Mosaic } from '../components/Mosaic';
import { TweetThreadList } from '../components/TweetCard';

// Every world, the personal one included. A personal topic marked private reads as
// absent until the viewer signs in (row level security, lib/db.ts), so the widget
// puts its sign-in form up in place of the collection (the `signin` step below).
const WORLDS = DOMAINS;

/** The single-picture view fills the iframe, so the iframe's width is the slot. */
const SINGLE_SIZES = '100vw';

type Step =
  | { kind: 'world' }
  | { kind: 'dataset'; domain: Domain }
  /** Nothing came back and nobody's signed in — it may be a private collection: show
   *  the sign-in form, then do `retry` once signed in. */
  | { kind: 'signin'; retry: () => void }
  | { kind: 'browse'; ds: EmbedDataset };

/** How the slideshow steps through the dataset: a random pass, or oldest-first. */
type PlayMode = 'shuffle' | 'chronological';

/** A permutation of `0..n-1` — the browsing order for the given mode. Shuffle
 * plays a full random pass (a Fisher-Yates shuffle) rather than picking a fresh
 * random index each time, so pictures don't repeat until the whole set has. */
function buildOrder(items: EmbedItem[], mode: PlayMode): number[] {
  const order = items.map((_, i) => i);
  if (mode === 'chronological') {
    order.sort((a, b) => {
      const ya = items[a].year ?? Infinity;
      const yb = items[b].year ?? Infinity;
      return ya !== yb ? ya - yb : a - b;
    });
    return order;
  }
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * The whole point of this page (main.tsx routes it outside the app's Nav/layout
 * shell): a bare, iframeable, SELF-CONTAINED picture widget — `<iframe src=".../embed">`
 * on any other site, sized however the embedder likes. No app chrome, no auth, no
 * dataset-specific URL to hand-build: paste the one generic src once, and the widget
 * itself walks pick-a-world -> pick-a-dataset -> browse-with-shuffle. Change the
 * iframe's width/height and that's the entire integration surface.
 *
 * `/embed/:domain/:slug` and `/embed/:datasetId` still work as direct deep links into
 * the browse step for one specific dataset (skipping the picker) — useful for a site
 * that always wants the same field, e.g. a permanent "wallpaper" of one collection.
 */
export function Embed() {
  const { datasetId, slug, domain: domainParam } = useParams();
  const deepLink = slug ?? datasetId ?? '';
  // Edit mode is switched by the host page (lib/embedProtocol.ts), never by the URL, so
  // a visitor can't open the settings panel by editing the address. Starts in view.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== EMBED_MODE_MESSAGE) return;
      setEditing(e.data.mode === 'edit');
    };
    window.addEventListener('message', onMessage);
    // Asked after listening, so the host's answer can't arrive before we can hear it.
    if (window.parent !== window) window.parent.postMessage({ type: EMBED_READY_MESSAGE }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const [step, setStep] = useState<Step>({ kind: 'world' });
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [error, setError] = useState('');
  const { email } = useAuth();

  const openDataset = useCallback(
    (id: string) => {
      setError('');
      db.getEmbed(id)
        .then((ds) => {
          if (ds) setStep({ kind: 'browse', ds });
          else if (!email) setStep({ kind: 'signin', retry: () => openDataset(id) });
          else setError('Dataset not found');
        })
        .catch((e: Error) => setError(e.message ?? 'Could not load this'));
    },
    [email],
  );

  // A deep-linked embed skips straight to browsing — no picker shown at all.
  useEffect(() => {
    if (deepLink) openDataset(deepLink);
    else setStep({ kind: 'world' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  const openWorld = useCallback((domain: Domain) => {
    setError('');
    setDatasets(null);
    setStep({ kind: 'dataset', domain });
    db.listDatasets(domain)
      .then(setDatasets)
      .catch((e: Error) => setError(e.message ?? 'Could not load this'));
  }, []);

  // Signing in (in the form the `signin` step shows) makes the call that was refused.
  useEffect(() => {
    if (step.kind === 'signin' && email) step.retry();
  }, [step, email]);

  // A deep-linked embed that failed to load shows only the error — never the picker,
  // which would just invite browsing to something else instead of what was linked.
  if (deepLink && error && step.kind !== 'browse') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-wall)] p-4 text-center text-sm text-[var(--color-muted)]">
        {error}
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[var(--color-wall)]">
      {step.kind === 'world' && <WorldPicker onPick={openWorld} />}
      {step.kind === 'signin' && (
        <div className="h-full w-full overflow-y-auto">
          {supabase ? (
            <SignIn title="A private collection" blurb="Sign in to see what's here." />
          ) : (
            <Misconfigured />
          )}
        </div>
      )}
      {step.kind === 'dataset' && (
        <DatasetPicker
          domain={step.domain}
          datasets={datasets}
          error={error}
          onBack={() => setStep({ kind: 'world' })}
          onPick={openDataset}
        />
      )}
      {step.kind === 'browse' && (
        <Browse ds={step.ds} onBack={deepLink ? undefined : () => setStep({ kind: 'world' })} />
      )}
      {editing && <EditPanel domainParam={domainParam} slug={slug ?? ''} />}
    </div>
  );
}

// ---- Edit mode (set by the host, see lib/embedProtocol.ts): the settings panel, inside the iframe ----
// This IS what a website builder's editor shows (the /iframe tester flips the same mode,
// so it previews exactly this). A scrim over the widget, and the panel on the right half
// — or the whole frame when it's too narrow to split. Nothing here can be dismissed from
// inside: the host decides when editing ends, not the widget.
//
// The pickers are custom listboxes rather than native <select>s on purpose: builders
// zoom their canvas with `transform: scale()`, and Chromium positions a native select's
// popup wrongly for an iframe under a transformed ancestor (the list lands off to the
// side of the field). A list drawn in the panel's own DOM can't go anywhere else.
const NARROW_FRAME = 560;

function EditPanel({ domainParam, slug }: { domainParam?: string; slug: string }) {
  const navigate = useNavigate();
  const initialWorld = WORLDS.find((w) => w === domainParam) ?? '';
  const [world, setWorld] = useState<Domain | ''>(initialWorld);
  const [topics, setTopics] = useState<DatasetSummary[] | null>(null);
  const [width, setWidth] = useState(String(window.innerWidth));
  const [height, setHeight] = useState(String(window.innerHeight));
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW_FRAME);
  // The personal world lists nothing until signed in; re-asked once that happens.
  const { email } = useAuth();

  useEffect(() => {
    setTopics(null);
    if (!world) return;
    db.listDatasets(world).catch(() => [] as DatasetSummary[]).then(setTopics);
  }, [world, email]);

  const post = useCallback(
    (size?: { width: number; height: number }) => {
      if (window.parent === window) return;
      const src = `${window.location.origin}/embed${slug ? `/${domainParam}/${slug}` : ''}`;
      window.parent.postMessage(
        {
          type: EMBED_CONFIG_MESSAGE,
          world: slug ? domainParam : null,
          topic: slug || null,
          src,
          width: size?.width ?? window.innerWidth,
          height: size?.height ?? window.innerHeight,
        },
        // The host's origin is unknowable from in here, and nothing in this is secret.
        '*',
      );
    },
    [domainParam, slug],
  );

  useEffect(() => post(), [post]);

  // The fields mirror the iframe's real size, so a host that resizes it by dragging
  // stays in sync with what's typed here.
  useEffect(() => {
    const onResize = () => {
      setWidth(String(window.innerWidth));
      setHeight(String(window.innerHeight));
      setNarrow(window.innerWidth < NARROW_FRAME);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function commitSize() {
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (w > 0 && h > 0) post({ width: w, height: h });
  }

  // A world without a topic is "visitor picks" — the src stays the generic /embed
  // (same as the tester's), the world only decides which topics are listed.
  function pickWorld(next: Domain | '') {
    setWorld(next);
    if (slug) navigate('/embed', { replace: true });
  }
  function pickTopic(nextSlug: string) {
    navigate(`/embed${nextSlug && world ? `/${world}/${nextSlug}` : ''}`, { replace: true });
  }

  const label = 'block text-[0.7rem] font-semibold text-[var(--color-muted)]';

  // The snippet and wiring live in this column with the settings — one panel is the
  // whole edit surface, and the frame is the same size in edit and view mode. They
  // read from the fields, so what's typed is what's copied.
  const origin = window.location.origin;
  const src = `${origin}/embed${slug ? `/${domainParam}/${slug}` : ''}`;
  const code = `<iframe id="tt-embed" src="${src}" width="${width}" height="${height}" style="border:0;border-radius:12px" loading="lazy"></iframe>`;
  const wiring = `<script>
var f = document.getElementById('tt-embed');
var MODE = 'view';
function send() {
  f.contentWindow.postMessage(
    { type: '${EMBED_MODE_MESSAGE}', mode: MODE }, '${origin}');
}
// Call this whenever your editor flips this element: setMode('edit') / setMode('view')
function setMode(m) { MODE = m; send(); }
addEventListener('message', function (e) {
  if (e.source !== f.contentWindow) return;
  var d = e.data || {};
  if (d.type === '${EMBED_READY_MESSAGE}') send();
  if (d.type === '${EMBED_CONFIG_MESSAGE}') {
    save(d.src);            // YOUR code: store d.src as this element's setting
    f.width = d.width;
    f.height = d.height;
  }
});
</script>`;
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  const codeField = `${EDIT_FIELD} font-mono text-[10px] leading-snug`;
  const btn = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 text-xs hover:bg-[var(--color-wall-soft)]';

  return (
    <>
      <div className="absolute inset-0 z-20 bg-black/25" />
      <aside
        className={`absolute inset-y-0 right-0 z-20 space-y-2.5 overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-card)] p-3 text-xs shadow-lg ${
          narrow ? 'left-0 w-full border-l-0' : 'w-1/2'
        }`}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Settings</h3>
        <div className="space-y-1">
          <label className={label} htmlFor="embed-world">World</label>
          <Dropdown
            id="embed-world"
            value={world}
            onChange={(v) => pickWorld(v as Domain | '')}
            options={[
              { value: '', label: 'Visitor picks (no fixed topic)' },
              ...WORLDS.map((w) => ({ value: w, label: DOMAIN_LABELS[w].title })),
            ]}
          />
        </div>
        {world && (
          <div className="space-y-1">
            <label className={label} htmlFor="embed-topic">Topic</label>
            <Dropdown
              id="embed-topic"
              value={world === domainParam ? slug : ''}
              disabled={topics === null}
              onChange={pickTopic}
              options={[
                {
                  value: '',
                  label:
                    topics === null
                      ? 'Loading…'
                      : world === 'personal' && !email
                        ? 'Sign in (in the widget) to list yours'
                        : 'Visitor picks a topic',
                },
                ...(topics ?? []).map((d) => ({ value: slugifyTopic(d.topic), label: d.topic })),
              ]}
            />
          </div>
        )}
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label className={label} htmlFor="embed-width">Width (px)</label>
            <input id="embed-width" type="number" min={220} step={10} className={EDIT_FIELD} value={width}
              onChange={(e) => setWidth(e.target.value)} onBlur={commitSize}
              onKeyDown={(e) => e.key === 'Enter' && commitSize()} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className={label} htmlFor="embed-height">Height (px)</label>
            <input id="embed-height" type="number" min={160} step={10} className={EDIT_FIELD} value={height}
              onChange={(e) => setHeight(e.target.value)} onBlur={commitSize}
              onKeyDown={(e) => e.key === 'Enter' && commitSize()} />
          </div>
        </div>
        <details open className="rounded-lg border border-[var(--color-line)]">
          <summary className="cursor-pointer px-2 py-1.5 font-semibold">Embed code</summary>
          <div className="space-y-2 px-2 pb-2">
            <textarea readOnly value={code} wrap="off" className={`${codeField} h-16`} />
            <button type="button" onClick={() => copy(code)} className={btn}>Copy embed code</button>
          </div>
        </details>
        <details className="rounded-lg border border-[var(--color-line)]">
          <summary className="cursor-pointer px-2 py-1.5 font-semibold">Editor wiring</summary>
          <div className="space-y-2 px-2 pb-2">
            <p className="text-[var(--color-muted)]">
              For a website builder: the frame starts in view mode and your editor flips it — the URL can't.
            </p>
            <textarea readOnly value={wiring} wrap="off" className={`${codeField} h-40`} />
            <button type="button" onClick={() => copy(wiring)} className={btn}>Copy wiring</button>
          </div>
        </details>
      </aside>
    </>
  );
}

const EDIT_FIELD = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 py-1 text-xs text-[var(--color-ink)]';

/** A select that draws its list in the panel's own DOM (see EditPanel for why not a
 *  native one). Closes on a click anywhere else or Escape. */
function Dropdown({
  id,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${EDIT_FIELD} flex items-center justify-between gap-2 text-left disabled:opacity-50`}
      >
        <span className="truncate">{current?.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--color-muted)]">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 shadow-lg"
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-[var(--color-wall-soft)] ${
                  o.value === value ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink)]/85'
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Step 1: pick a world ----
function WorldPicker({ onPick }: { onPick: (domain: Domain) => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <p className="mb-1 text-sm text-[var(--color-muted)]">Browse</p>
      {WORLDS.map((domain) => (
        <button
          key={domain}
          onClick={() => onPick(domain)}
          className="w-full max-w-xs rounded-full bg-[var(--color-ink)] px-5 py-2.5 text-sm text-[var(--color-wall)] hover:opacity-90"
        >
          {DOMAIN_LABELS[domain].title}
        </button>
      ))}
    </div>
  );
}

// ---- Step 2: pick a dataset within that world ----
function DatasetPicker({
  domain,
  datasets,
  error,
  onBack,
  onPick,
}: {
  domain: Domain;
  datasets: DatasetSummary[] | null;
  error: string;
  onBack: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col p-4">
      <button onClick={onBack} className="mb-2 self-start text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← {DOMAIN_LABELS[domain].title}
      </button>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {!error && datasets === null && (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      )}
      {datasets && datasets.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">No datasets yet in {DOMAIN_LABELS[domain].title}.</p>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {datasets?.map((d) => (
          <button
            key={d.id}
            onClick={() => onPick(d.id)}
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2 text-left text-sm hover:bg-[var(--color-wall-soft)]"
          >
            {d.private && (
              <LockIcon className="mr-1.5 inline-block align-[-2px] text-[var(--color-muted)]" />
            )}
            {d.topic}
            <span className="ml-1 text-xs text-[var(--color-muted)]">({d.itemCount})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Step 3: browse one dataset — either a retro slideshow, one picture at a time
// with next/previous (shuffle or chronological order), or the whole field at once
// (a zoomable/pannable mosaic of every picture, Mosaic.tsx) ----
function Browse({ ds, onBack }: { ds: EmbedDataset; onBack?: () => void }) {
  const [viewMode, setViewMode] = useState<'slideshow' | 'mosaic'>('slideshow');
  const [playMode, setPlayMode] = useState<PlayMode>('shuffle');
  const [order, setOrder] = useState<number[]>(() => buildOrder(ds.items, 'shuffle'));
  const [pos, setPos] = useState(0);
  // Set only while a next/prev transition is animating: the outgoing picture
  // (at `prevPos`) slides off in `dir` while the new current picture slides in.
  // `fromX` is how far a finger had already dragged the card when it let go (0 for
  // a button/keyboard step), so the animation carries on from where the finger
  // left it rather than jumping back to centre first.
  const [slide, setSlide] = useState<{ prevPos: number; dir: 1 | -1; fromX: number } | null>(null);

  const goTo = useCallback(
    (newPos: number, dir: 1 | -1, fromX = 0) => {
      if (order.length < 2 || slide) return;
      setSlide({ prevPos: pos, dir, fromX });
      setPos(newPos);
    },
    [order.length, pos, slide],
  );
  const goNext = useCallback((fromX = 0) => goTo((pos + 1) % order.length, 1, fromX), [goTo, pos, order.length]);
  const goPrev = useCallback((fromX = 0) => goTo((pos - 1 + order.length) % order.length, -1, fromX), [goTo, pos, order.length]);

  // Touch: swipe left for the next card, right for the previous one, tap to flip.
  // The card follows the finger (`dragX`) and either snaps back or, past a
  // threshold, completes the move via the same slide animation the buttons use.
  // A swipe must not also count as the tap that flips the card: `swipedRef` is set
  // once a horizontal drag is recognised and the click handlers check it, since
  // the browser still fires `click` after a touch that moved. The container's
  // `touch-action: pan-y` leaves vertical scrolling (a thread, the back of a card)
  // to the browser, which cancels our pointer when it takes a vertical pan.
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; startX: number; startY: number; dx: number; horizontal: boolean } | null>(null);
  const swipedRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Any fresh press clears the last swipe — a mouse click that follows a touch
    // swipe on a hybrid device should still flip.
    swipedRef.current = false;
    if (e.pointerType === 'mouse' || slide) return;
    // Dragging inside the report form is selecting text, not browsing. Dragging
    // inside a thread's own scroll area is reading it — capturing the pointer here
    // (below) would hijack that native vertical scroll before it can start.
    if ((e.target as Element).closest('textarea, input, .tweet-scroll')) return;
    dragRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, dx: 0, horizontal: false };
    // Without this, once the finger moves over a child element with different hit
    // testing (the picture itself, which iOS also offers a native drag/callout on),
    // move/up events can stop reaching this handler and the browser can cancel the
    // gesture outright — which is why swipe would work in some spots and not others.
    // Pinning every subsequent pointer event to this element regardless of what's
    // under the finger is what makes the drag reliable end to end.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* unsupported in this engine — falls back to normal hit-testing */
    }
  }
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.horizontal) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return;
      d.horizontal = true;
      swipedRef.current = true;
      setDragging(true);
    }
    // With only one card there's nowhere to go: a stiff rubber band says so.
    d.dx = canBrowse ? dx : dx / 4;
    setDragX(d.dx);
  }
  function endDrag(e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.horizontal) return;
    setDragging(false);
    const width = containerRef.current?.clientWidth ?? window.innerWidth;
    const threshold = Math.min(80, width * 0.25);
    if (!cancelled && canBrowse && Math.abs(d.dx) > threshold) {
      if (d.dx < 0) goNext(d.dx);
      else goPrev(d.dx);
    }
    setDragX(0);
  }

  // Switching shuffle/chronological rebuilds the order but stays on the same
  // picture — only where you go from here changes, not what's on screen.
  const switchPlayMode = useCallback(
    (mode: PlayMode) => {
      setPlayMode((prev) => {
        if (prev === mode) return prev;
        const currentItem = order[pos];
        const nextOrder = buildOrder(ds.items, mode);
        const nextPos = nextOrder.indexOf(currentItem);
        setOrder(nextOrder);
        setPos(nextPos === -1 ? 0 : nextPos);
        setSlide(null);
        return mode;
      });
    },
    [ds.items, order, pos],
  );

  // Tapping a tile in the mosaic jumps the slideshow straight to it, no transition.
  const openItemIndex = useCallback(
    (itemIndex: number) => {
      const p = order.indexOf(itemIndex);
      setSlide(null);
      setPos(p === -1 ? 0 : p);
      setViewMode('slideshow');
    },
    [order],
  );

  // The card flip (click the picture -> its info + a report button, on the back) and
  // the report form under it. Both belong to whichever picture is on screen, so
  // leaving it — next/prev, mosaic, a fresh dataset — resets them rather than
  // carrying a stale draft or an already-sent confirmation onto the next picture.
  //
  // `restAngle` is the settled rotation — 0 (front) or 180 (back), never anything
  // else once an animation finishes. A flip always animates rest -> rest+180 and
  // keeps going the same way round every time (front->back is 0->180, and the next
  // back->front is 180->360, which looks identical to 0 but arrives by continuing
  // to spin rather than winding back the way it came) — a revolving door, not a
  // door that swings open and shut. `restAngle` then snaps 360 back down to 0 (same
  // angle, so nothing visibly changes) purely so the number doesn't grow forever.
  const [restAngle, setRestAngle] = useState(0);
  const [animating, setAnimating] = useState(false);
  const flipped = restAngle === 180;
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [reportState, setReportState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [reportError, setReportError] = useState('');
  useEffect(() => {
    setRestAngle(0);
    setAnimating(false);
    setReportOpen(false);
    setReportText('');
    setReportState('idle');
    setReportError('');
  }, [pos, viewMode]);

  // Ignoring a click mid-animation stops a fast double-click from restarting the
  // turn partway through.
  function flipTo(next: boolean) {
    // A thread has nothing to put on a back — its words are already the front.
    if (swipedRef.current || animating || next === flipped || current.tweet) return;
    setAnimating(true);
  }
  // The chrome around the picture (top bars, caption, prev/next) hides for the whole
  // turn, not just once it settles — otherwise it would reappear mid-flip, while the
  // front is still rotating past face-on.
  const showingBack = flipped || animating;

  async function submitReport(item: EmbedItem) {
    const text = reportText.trim();
    if (!text) return;
    setReportState('sending');
    setReportError('');
    try {
      await db.createReport(ds, item, text);
      setReportState('sent');
    } catch (e: any) {
      setReportState('error');
      setReportError(e?.message ?? 'Could not send that — try again.');
    }
  }

  // Warm the cache for both neighbours — whichever way the visitor goes next, same
  // srcset + sizes as the Photo that will show it, so the browser reuses the file.
  useEffect(() => {
    if (viewMode !== 'slideshow' || order.length < 2) return;
    for (const d of [1, -1]) {
      const src = ds.items[order[(pos + d + order.length) % order.length]]?.image;
      if (!src) continue;
      const img = new Image();
      const srcSet = thumbSrcSet(src);
      if (srcSet) {
        img.sizes = SINGLE_SIZES;
        img.srcset = srcSet;
      }
      img.src = src;
    }
  }, [pos, order, viewMode, ds.items]);

  if (ds.items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-[var(--color-muted)]">
        {ds.topic} has no pictures yet.
      </div>
    );
  }

  const current = ds.items[order[pos]];
  const canBrowse = ds.items.length > 1;

  // Every piece of chrome (back, mode toggles, caption, prev/next) lives in this
  // `group` and only shows on hover — the photo itself displays uninterrupted
  // otherwise. `opacity-0`+`pointer-events-none` at rest so hidden controls can't
  // eat clicks meant for the image; hover reveals both together.
  // On a touch screen there is no hover to reveal any of this, so `embed-chrome`
  // (index.css) hides it outright there — the utility bar below the picture (also
  // this component, rendered further down) carries the same controls instead.
  const chrome = 'embed-chrome opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto';

  return (
    <div className="flex h-full w-full flex-col">
    <div className="group relative min-h-0 flex-1">
      {!showingBack && (
      <div className={`absolute left-3 top-3 z-10 flex items-center gap-1.5 ${chrome}`}>
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Choose a different dataset"
            title="Choose a different dataset"
            className="rounded-full bg-[var(--color-ink)]/70 px-3 py-1.5 text-xs text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)]"
          >
            ← {ds.topic}
          </button>
        )}
      </div>
      )}

      {/* Bottom right: two metal switches. Mosaic view on = every picture at once,
          off (the default) = one picture at a time; Shuffle on = random pass, off = oldest-first. */}
      {canBrowse && !showingBack && (
        <div className={`absolute bottom-3 right-3 z-10 flex items-center gap-3 rounded-full bg-[var(--color-ink)]/60 px-3 py-1.5 backdrop-blur ${chrome}`}>
          {viewMode === 'slideshow' && (
            <MetalToggle
              label="Shuffle"
              checked={playMode === 'shuffle'}
              onChange={(on) => switchPlayMode(on ? 'shuffle' : 'chronological')}
            />
          )}
          <MetalToggle
            label="Mosaic view"
            checked={viewMode === 'mosaic'}
            onChange={(on) => setViewMode(on ? 'mosaic' : 'slideshow')}
          />
        </div>
      )}

      {viewMode === 'mosaic' ? (
        <Mosaic items={ds.items} onOpenItem={openItemIndex} />
      ) : (
        <>
          <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, false)}
            onPointerCancel={(e) => endDrag(e, true)}
            style={{ touchAction: 'pan-y' }}
            className="relative h-full w-full overflow-hidden bg-[var(--color-ink)]"
          >
            {slide && (
              <div
                key={`out-${slide.prevPos}`}
                onAnimationEnd={() => setSlide(null)}
                style={{ '--slide-from': `${slide.fromX}px` } as React.CSSProperties}
                className={`absolute inset-0 ${slide.dir === 1 ? 'embed-slide-exit-next' : 'embed-slide-exit-prev'}`}
              >
                <Slide item={ds.items[order[slide.prevPos]]} />
              </div>
            )}
            <div
              key={`in-${pos}`}
              style={
                slide
                  ? ({ '--slide-from': `${slide.fromX}px` } as React.CSSProperties)
                  : {
                      transform: `translateX(${dragX}px)`,
                      transition: dragging ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }
              }
              className={`absolute inset-0 ${current.tweet ? '' : 'embed-flip-perspective'} ${slide ? (slide.dir === 1 ? 'embed-slide-enter-next' : 'embed-slide-enter-prev') : ''}`}
            >
              {/* A thread has nothing to put on a back (it scrolls in place; there's
                  nothing to flip to), so it skips the flip machinery entirely rather
                  than just sitting on the front of it — WebKit has a long-standing bug
                  where an `overflow-y: auto` descendant of a `perspective`/
                  `preserve-3d` ancestor (the flip card below) stops responding to touch
                  scrolling, which was cutting off the bottom of longer threads on
                  mobile with no way to reach it. Tapping the tweet still opens it on X,
                  same as the picture's own tap-to-flip, so a swipe's trailing synthetic
                  click (swipedRef, set in onPointerMove above) must not also be read as
                  that tap. */}
              {current.tweet ? (
                <div
                  className="h-full w-full"
                  onClickCapture={(e) => {
                    if (swipedRef.current) e.preventDefault();
                  }}
                >
                  <Slide item={current} />
                </div>
              ) : (
                <div
                  className={`embed-flip-inner ${animating ? 'embed-flip-anim' : ''}`}
                  style={
                    animating
                      ? ({
                          '--flip-from': `${restAngle}deg`,
                          '--flip-mid': `${restAngle + 90}deg`,
                          '--flip-to': `${restAngle + 180}deg`,
                        } as React.CSSProperties)
                      : { transform: `rotateY(${restAngle}deg)` }
                  }
                  onAnimationEnd={() => {
                    setRestAngle((a) => (a + 180) % 360);
                    setAnimating(false);
                  }}
                >
                  {/* Front: the picture itself. Click anywhere on it to flip. */}
                  <button
                    onClick={() => flipTo(true)}
                    aria-label="Show this picture's details"
                    title="Click for details"
                    className="embed-flip-face block h-full w-full cursor-pointer"
                  >
                    <Slide item={current} />
                  </button>

                  {/* Back: read-mode info + a way to flag a problem with this item. Click
                      anywhere on it (like the front) to flip back — the report controls
                      below stop that click from bubbling up, so using them doesn't also
                      flip the card back over. */}
                  <div
                    onClick={() => flipTo(false)}
                    role="button"
                    aria-label="Back to the picture"
                    title="Click for the picture"
                    className="embed-flip-face embed-flip-face-back flex cursor-pointer flex-col overflow-y-auto bg-[var(--color-wall)] p-6 text-[var(--color-ink)]"
                  >
                    <h2 className="serif text-xl leading-tight">{current.name || 'Untitled'}</h2>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {[current.year ?? undefined, current.brand].filter(Boolean).join(' · ') || '—'}
                    </p>

                    {(current.description || current.definingFact) && (
                      <div className="mt-4 space-y-2 text-sm leading-relaxed text-[var(--color-ink)]/90">
                        {current.description && <p>{current.description}</p>}
                        {current.definingFact && (
                          <p className="italic text-[var(--color-muted)]">{current.definingFact}</p>
                        )}
                      </div>
                    )}

                    <div className="mt-auto flex flex-col items-center pt-6 text-center" onClick={(e) => e.stopPropagation()}>
                      {reportState === 'sent' ? (
                        <p className="text-sm text-[var(--color-ink)]/80">
                          Thanks — this has been flagged for the curator to look at.
                        </p>
                      ) : reportOpen ? (
                        <div className="w-full space-y-2 text-left">
                          <textarea
                            autoFocus
                            value={reportText}
                            onChange={(e) => setReportText(e.target.value)}
                            placeholder="What's wrong with this one? Wrong picture, wrong year, wrong name…"
                            rows={4}
                            maxLength={2000}
                            className="w-full resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)]/5 p-2.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                          />
                          {reportState === 'error' && (
                            <p className="text-xs text-[var(--color-accent)]">{reportError}</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => submitReport(current)}
                              disabled={!reportText.trim() || reportState === 'sending'}
                              className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs text-white disabled:opacity-40"
                            >
                              {reportState === 'sending' ? 'Sending…' : 'Send report'}
                            </button>
                            <button
                              onClick={() => {
                                setReportOpen(false);
                                setReportText('');
                                setReportState('idle');
                              }}
                              disabled={reportState === 'sending'}
                              className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-xs text-[var(--color-ink)] disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setReportOpen(true)}
                          className="rounded-full bg-[#e88a8a] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#e17676]"
                        >
                          Report a problem
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {!showingBack && (
            <div
              className={`absolute bottom-3 left-3 z-10 max-w-[70%] truncate rounded-full bg-[var(--color-ink)]/60 px-3 py-1 text-xs text-[var(--color-wall)] backdrop-blur ${chrome}`}
            >
              {current.name}
              {current.year ? ` · ${current.year}` : ''}
            </div>
          )}

          {canBrowse && !showingBack && (
            <>
              <button
                onClick={() => goPrev()}
                aria-label="Previous picture"
                title="Previous"
                className={`embed-arrow absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/60 p-2.5 text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
              >
                <ChevronIcon direction="left" />
              </button>
              <button
                onClick={() => goNext()}
                aria-label="Next picture"
                title="Next"
                className={`embed-arrow absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/60 p-2.5 text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
              >
                <ChevronIcon direction="right" />
              </button>
            </>
          )}
        </>
      )}
    </div>

    {/* Narrow/touch only (index.css): the desktop hover-chrome above hides completely
        there (a permanent overlay on top of the picture was the awkward part) — this
        bar, in normal document flow below the picture rather than floating over it,
        carries the same controls instead: prev/next pinned to the bar's own left/right
        edges (a swipe's fallback belongs where a thumb expects it, not buried in the
        middle), the view toggle dead centre (the one most worth a big, easy target),
        the play-mode toggle right beside it, and the title, dropped only for a tweet —
        there's nothing to caption; tapping the picture still flips it to the
        description for anything that has one. A solid "metal" grey rather than the
        picture's own warm wall colour, so it reads as a fixed control strip, not part
        of the photo. */}
    <div className="embed-utility-bar items-stretch justify-between gap-1 border-t border-[#2a2a2a] bg-[#3c3c3e] px-1 py-1.5 text-[#f2f2f2]">
      {canBrowse && viewMode === 'slideshow' ? (
        <button
          onClick={() => goPrev()}
          disabled={!!showingBack}
          aria-label="Previous picture"
          title="Previous"
          className="flex shrink-0 items-center rounded-full px-1.5 hover:bg-white/10 disabled:opacity-40"
        >
          <ChevronIcon direction="left" />
        </button>
      ) : (
        <span />
      )}

      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1">
        <div className="flex w-full items-center justify-between">
          {onBack ? (
            <button
              onClick={onBack}
              aria-label="Choose a different dataset"
              title="Choose a different dataset"
              className="rounded-full p-1.5 hover:bg-white/10"
            >
              <ChevronIcon direction="left" />
            </button>
          ) : (
            <span />
          )}
          {!current.tweet && !showingBack && viewMode === 'slideshow' && (
            <span className="min-w-0 max-w-[55%] truncate text-[11px] text-[#d8d8d8]">
              {current.name}
              {current.year ? ` · ${current.year}` : ''}
            </span>
          )}
          <span />
        </div>

        {/* The current mode is the only symbol shown — an outline marks it as a
            button, and clicking it swaps in the icon for the mode it just switched
            to. Showing both options side by side (an earlier version of this) read
            as "which of these is on?" instead of "what will this button do?". */}
        <div className="flex items-center gap-1.5">
          {canBrowse && (
            <button
              onClick={() => setViewMode(viewMode === 'slideshow' ? 'mosaic' : 'slideshow')}
              aria-label={viewMode === 'slideshow' ? 'Single view — switch to mosaic' : 'Mosaic — switch to single view'}
              title={viewMode === 'slideshow' ? 'Single view' : 'Mosaic'}
              className="flex items-center gap-1.5 rounded-full border border-white/25 px-2.5 py-1 text-[11px] hover:bg-white/10 active:bg-white/15"
            >
              {viewMode === 'slideshow' ? <SingleIcon size={14} /> : <MosaicIcon size={14} />}
              {viewMode === 'slideshow' ? 'Image' : 'Mosaic'}
            </button>
          )}
          {canBrowse && viewMode === 'slideshow' && (
            <button
              onClick={() => switchPlayMode(playMode === 'shuffle' ? 'chronological' : 'shuffle')}
              aria-label={playMode === 'shuffle' ? 'Shuffle: on — switch to linear order' : 'Linear order — switch to shuffle'}
              title={playMode === 'shuffle' ? 'Shuffle' : 'Linear order'}
              className="flex items-center rounded-full border border-white/25 p-1.5 hover:bg-white/10 active:bg-white/15"
            >
              {playMode === 'shuffle' ? <ShuffleIcon className="h-3.5 w-3.5" /> : <LinearIcon />}
            </button>
          )}
        </div>
      </div>

      {canBrowse && viewMode === 'slideshow' ? (
        <button
          onClick={() => goNext()}
          disabled={!!showingBack}
          aria-label="Next picture"
          title="Next"
          className="flex shrink-0 items-center rounded-full px-1.5 hover:bg-white/10 disabled:opacity-40"
        >
          <ChevronIcon direction="right" />
        </button>
      ) : (
        <span />
      )}
    </div>
    </div>
  );
}

/** One item filling the frame: its picture, or — for a saved thread — the thread
 *  itself, read top to bottom, with the same X embeds the app's own wall opens. */
function Slide({ item }: { item: EmbedItem }) {
  if (!item.tweet) {
    return <Photo src={item.image} alt={item.name} className="h-full w-full" sizes={SINGLE_SIZES} />;
  }
  return (
    <div
      className="tweet-scroll custom-scroll h-full w-full overflow-y-auto overscroll-contain bg-[var(--color-wall)] text-[var(--color-ink)]"
      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
    >
      <div className="space-y-3 p-4">
        <TweetThreadList tweets={item.tweet.tweets} fallback={item} plain />
      </div>
    </div>
  );
}

/** A minimalist brushed-metal switch with a label: a recessed steel track, a
 *  chrome knob that slides right when on, and a thin accent glow on the track. */
function MetalToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={`${label}: ${checked ? 'on' : 'off'}`}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-xs text-[#f2f2f2]"
    >
      <span>{label}</span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full border border-[#1a1a1a] shadow-[inset_0_1px_3px_rgba(0,0,0,0.7)] transition-colors duration-150 ${
          checked
            ? 'bg-gradient-to-b from-[#5a5a5e] to-[#7c7c82] ring-1 ring-[var(--color-accent)]'
            : 'bg-gradient-to-b from-[#2a2a2c] to-[#3e3e42]'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full border border-[#6a6a6e] bg-gradient-to-b from-[#f4f4f6] via-[#c2c2c8] to-[#8e8e94] shadow-[0_1px_2px_rgba(0,0,0,0.6)] transition-[left] duration-150 ${
            checked ? 'left-[1.1rem]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function ShuffleIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  );
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** A single straight path, in contrast to shuffle's crossed one — chronological
 *  order, not a random pass. */
function LinearIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 12h13" />
      <path d="M12 6l6 6-6 6" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

function MosaicIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SingleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="m5 17 4.5-5 3 3 3.5-4 3 3.5" />
    </svg>
  );
}
