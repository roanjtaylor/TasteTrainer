import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DOMAINS, DOMAIN_LABELS, slugifyTopic } from '../../../shared/types';
import type { DatasetSummary, Domain, EmbedDataset, EmbedItem } from '../../../shared/types';
import { api, HttpError } from '../lib/api';
import { Misconfigured, SignIn, useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { thumbSrcSet } from '../lib/image';
import { Photo } from '../components/Photo';
import { Mosaic } from '../components/Mosaic';
import { TweetThreadList } from '../components/TweetCard';

// Every world, the personal one included: it's hand-built and private, so the server
// answers 401 for it until the viewer signs in (routes/embed.ts) and the widget puts
// its sign-in form up in place of the collection (the `signin` step below).
const WORLDS = DOMAINS;

/** The single-picture view fills the iframe, so the iframe's width is the slot. */
const SINGLE_SIZES = '100vw';

type Step =
  | { kind: 'world' }
  | { kind: 'dataset'; domain: Domain }
  /** The server said 401: show the sign-in form, then do `retry` once signed in. */
  | { kind: 'signin'; retry: () => void }
  | { kind: 'browse'; ds: EmbedDataset };

/** Recover from a failed request: a 401 becomes the sign-in step (with the same call
 *  to make again afterwards), anything else is an error to show. */
function stepOrError(e: unknown, retry: () => void, setStep: (s: Step) => void, setError: (m: string) => void): void {
  if (e instanceof HttpError && e.status === 401) setStep({ kind: 'signin', retry });
  else setError((e as Error)?.message ?? 'Could not load this');
}

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
  const [searchParams] = useSearchParams();
  const editing = searchParams.get('mode') === 'edit';

  const [step, setStep] = useState<Step>({ kind: 'world' });
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [error, setError] = useState('');
  const { email } = useAuth();

  const openDataset = useCallback((id: string) => {
    setError('');
    api
      .getEmbed(id)
      .then((ds) => setStep({ kind: 'browse', ds }))
      .catch((e) => stepOrError(e, () => openDataset(id), setStep, setError));
  }, []);

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
    api
      .listDatasets(domain)
      .then(setDatasets)
      .catch((e) => stepOrError(e, () => openWorld(domain), setStep, setError));
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

/** The message a host editor listens for (`window.addEventListener('message', …)`):
 * persist `src` for view mode and apply `width`/`height` to the iframe element — an
 * iframe can't resize itself, so the size fields are requests the host carries out. */
const EMBED_CONFIG_MESSAGE = 'tastetrainer:embed-config';

// ---- Edit mode (`?mode=edit`): the host editor's settings panel, inside the iframe ----
function EditPanel({ domainParam, slug }: { domainParam?: string; slug: string }) {
  const navigate = useNavigate();
  const initialWorld = WORLDS.find((w) => w === domainParam) ?? WORLDS[0];
  const [world, setWorld] = useState<Domain>(initialWorld);
  const [topics, setTopics] = useState<DatasetSummary[] | null>(null);
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(String(window.innerWidth));
  const [height, setHeight] = useState(String(window.innerHeight));
  // The personal world lists nothing until signed in; re-asked once that happens.
  const { email } = useAuth();

  useEffect(() => {
    setTopics(null);
    api.listDatasets(world).catch(() => [] as DatasetSummary[]).then(setTopics);
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
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function commitSize() {
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (w > 0 && h > 0) post({ width: w, height: h });
  }

  function pickTopic(nextSlug: string) {
    navigate(`/embed${nextSlug ? `/${world}/${nextSlug}` : ''}?mode=edit`, { replace: true });
  }

  const field = 'w-full rounded border border-[var(--color-line)] bg-[var(--color-card)] px-2 py-1.5 text-xs text-[var(--color-ink)]';
  const label = 'mb-1 block text-[0.7rem] font-semibold text-[var(--color-muted)]';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-3 right-3 z-20 rounded-full bg-[var(--color-ink)] px-3 py-1.5 text-xs text-[var(--color-wall)] shadow"
      >
        Edit embed
      </button>
    );
  }

  return (
    <div className="absolute inset-y-0 right-0 z-20 flex w-60 max-w-full flex-col gap-3 overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-wall)] p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-[0.7rem] uppercase tracking-wide text-[var(--color-muted)]">Starting view</span>
        <button onClick={() => setOpen(false)} aria-label="Hide settings" title="Hide settings" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
          ✕
        </button>
      </div>
      <div>
        <label className={label} htmlFor="embed-world">World</label>
        <select id="embed-world" className={field} value={world} onChange={(e) => setWorld(e.target.value as Domain)}>
          {WORLDS.map((w) => (
            <option key={w} value={w}>{DOMAIN_LABELS[w].title}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={label} htmlFor="embed-topic">Topic</label>
        <select
          id="embed-topic"
          className={field}
          value={world === domainParam ? slug : ''}
          disabled={topics === null}
          onChange={(e) => pickTopic(e.target.value)}
        >
          <option value="">
            {topics === null
              ? 'Loading…'
              : world === 'personal' && !email
                ? 'Sign in (in the widget) to list yours'
                : 'Visitor picks (no fixed topic)'}
          </option>
          {topics?.map((d) => (
            <option key={d.id} value={slugifyTopic(d.topic)}>{d.topic}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <label className={label} htmlFor="embed-width">Width (px)</label>
          <input id="embed-width" type="number" min={220} step={10} className={field} value={width}
            onChange={(e) => setWidth(e.target.value)} onBlur={commitSize}
            onKeyDown={(e) => e.key === 'Enter' && commitSize()} />
        </div>
        <div className="flex-1">
          <label className={label} htmlFor="embed-height">Height (px)</label>
          <input id="embed-height" type="number" min={160} step={10} className={field} value={height}
            onChange={(e) => setHeight(e.target.value)} onBlur={commitSize}
            onKeyDown={(e) => e.key === 'Enter' && commitSize()} />
        </div>
      </div>
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
  const [slide, setSlide] = useState<{ prevPos: number; dir: 1 | -1 } | null>(null);

  const goTo = useCallback(
    (newPos: number, dir: 1 | -1) => {
      if (order.length < 2 || slide) return;
      setSlide({ prevPos: pos, dir });
      setPos(newPos);
    },
    [order.length, pos, slide],
  );
  const goNext = useCallback(() => goTo((pos + 1) % order.length, 1), [goTo, pos, order.length]);
  const goPrev = useCallback(() => goTo((pos - 1 + order.length) % order.length, -1), [goTo, pos, order.length]);

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
    if (animating || next === flipped || current.tweet) return;
    setAnimating(true);
  }
  // The chrome around the picture (top bars, caption, prev/next) hides for the whole
  // turn, not just once it settles — otherwise it would reappear mid-flip, while the
  // front is still rotating past face-on.
  const showingBack = flipped || animating;

  async function submitReport(itemId: string) {
    const text = reportText.trim();
    if (!text) return;
    setReportState('sending');
    setReportError('');
    try {
      await api.reportItem(ds.id, itemId, text);
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
  const chrome = 'opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto';

  return (
    <div className="group relative h-full w-full">
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

        {canBrowse &&
          (viewMode === 'slideshow' ? (
            <button
              onClick={() => setViewMode('mosaic')}
              aria-label="Single view — switch to see every picture at once"
              title="Single view — switch to mosaic"
              className="flex items-center gap-1.5 rounded-full bg-[var(--color-ink)]/70 px-3 py-2 text-xs text-[var(--color-wall)] backdrop-blur transition hover:bg-[var(--color-ink)]"
            >
              <SingleIcon />
              Single view
            </button>
          ) : (
            <button
              onClick={() => setViewMode('slideshow')}
              aria-label="Mosaic — switch back to one picture"
              title="Mosaic — switch to single view"
              className="flex items-center gap-1.5 rounded-full bg-[var(--color-ink)]/70 px-3 py-2 text-xs text-[var(--color-wall)] backdrop-blur transition hover:bg-[var(--color-ink)]"
            >
              <MosaicIcon />
              Mosaic
            </button>
          ))}
      </div>
      )}

      {canBrowse && viewMode === 'slideshow' && !showingBack && (
        <div className={`absolute right-3 top-3 z-10 flex gap-1.5 ${chrome}`}>
          <button
            onClick={() => switchPlayMode(playMode === 'shuffle' ? 'chronological' : 'shuffle')}
            aria-label={playMode === 'shuffle' ? 'Shuffle: on — switch to linear order' : 'Linear order — switch to shuffle'}
            title={playMode === 'shuffle' ? 'Shuffle: on' : 'Linear order'}
            className="relative flex items-center gap-1.5 rounded-full bg-[var(--color-ink)]/70 px-3 py-2 text-xs backdrop-blur transition hover:bg-[var(--color-ink)]"
          >
            <ShuffleIcon className={playMode === 'shuffle' ? 'text-[var(--color-accent)]' : 'text-[var(--color-wall)]'} />
            <span className={playMode === 'shuffle' ? 'text-[var(--color-accent)]' : 'text-[var(--color-wall)]'}>
              {playMode === 'shuffle' ? 'Shuffle' : 'Linear'}
            </span>
            {playMode === 'shuffle' && (
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
            )}
          </button>
        </div>
      )}

      {viewMode === 'mosaic' ? (
        <Mosaic items={ds.items} onOpenItem={openItemIndex} />
      ) : (
        <>
          <div className="relative h-full w-full overflow-hidden bg-[var(--color-ink)]">
            {slide && (
              <div
                key={`out-${slide.prevPos}`}
                onAnimationEnd={() => setSlide(null)}
                className={`absolute inset-0 ${slide.dir === 1 ? 'embed-slide-exit-next' : 'embed-slide-exit-prev'}`}
              >
                <Slide item={ds.items[order[slide.prevPos]]} />
              </div>
            )}
            <div
              key={`in-${pos}`}
              className={`absolute inset-0 embed-flip-perspective ${slide ? (slide.dir === 1 ? 'embed-slide-enter-next' : 'embed-slide-enter-prev') : ''}`}
            >
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
                {/* Front: the picture itself. Click anywhere on it to flip. A thread
                    is read in place instead (it scrolls; there's nothing to flip to). */}
                {current.tweet ? (
                  <div className="embed-flip-face h-full w-full">
                    <Slide item={current} />
                  </div>
                ) : (
                  <button
                    onClick={() => flipTo(true)}
                    aria-label="Show this picture's details"
                    title="Click for details"
                    className="embed-flip-face block h-full w-full cursor-pointer"
                  >
                    <Slide item={current} />
                  </button>
                )}

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

                  <div className="mt-auto pt-6" onClick={(e) => e.stopPropagation()}>
                    {reportState === 'sent' ? (
                      <p className="text-sm text-[var(--color-ink)]/80">
                        Thanks — this has been flagged for the curator to look at.
                      </p>
                    ) : reportOpen ? (
                      <div className="space-y-2">
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
                            onClick={() => submitReport(current.id)}
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
                        className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
                      >
                        Report a problem
                      </button>
                    )}
                  </div>
                </div>
              </div>
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
                onClick={goPrev}
                aria-label="Previous picture"
                title="Previous"
                className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/60 p-2.5 text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
              >
                <ChevronIcon direction="left" />
              </button>
              <button
                onClick={goNext}
                aria-label="Next picture"
                title="Next"
                className={`absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/60 p-2.5 text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
              >
                <ChevronIcon direction="right" />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One item filling the frame: its picture, or — for a saved thread — the thread
 *  itself, read top to bottom, with the same X embeds the app's own wall opens. */
function Slide({ item }: { item: EmbedItem }) {
  if (!item.tweet) {
    return <Photo src={item.image} alt={item.name} className="h-full w-full" sizes={SINGLE_SIZES} />;
  }
  const lead = item.tweet.tweets.find((t) => !t.context) ?? item.tweet.tweets[0];
  return (
    <div className="h-full w-full overflow-y-auto bg-[var(--color-wall)] text-[var(--color-ink)]">
      <div className="mx-auto max-w-xl space-y-3 p-6">
        <TweetThreadList tweets={item.tweet.tweets} fallback={item} />
        {lead?.id && (
          <a
            href={`https://x.com/${lead.author || 'i'}/status/${lead.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-xs text-[var(--color-accent)] hover:underline"
          >
            Open on X ↗
          </a>
        )}
      </div>
    </div>
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

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={direction === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

function MosaicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SingleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="m5 17 4.5-5 3 3 3.5-4 3 3.5" />
    </svg>
  );
}
