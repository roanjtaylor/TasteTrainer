import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EmbedDataset, EmbedItem } from '../../../shared/types';
import * as db from '../lib/db';
import { thumbSrcSet } from '../lib/image';
import { Photo } from './Photo';
import { Mosaic } from './Mosaic';
import { ShuffleButton } from './ShuffleButton';
import { TweetThreadList } from './TweetCard';
import { InstagramPostView } from './InstagramCard';
import { TextView } from './TextCard';

/** The single-picture view fills the iframe, so the iframe's width is the slot. */
const SINGLE_SIZES = '100vw';

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

// ---- Browse one dataset — either a retro slideshow, one picture at a time with
// next/previous (shuffle or chronological order), or the whole field at once (a
// zoomable/pannable mosaic of every picture, Mosaic.tsx) ----
//
// Both the embed widget pinned to one dataset (pages/Embed.tsx) and the app's own
// dataset view on a phone (pages/DatasetView.tsx): the widget's narrow layout — utility
// bar below the picture, swipe, tap to flip — is the one mobile UI, kept here so
// there's a single source of it.
export function EmbedBrowse({
  ds,
  onBack,
  newestFirst = false,
  onViewModeChange,
}: {
  ds: EmbedDataset;
  /** A way out, drawn over the picture (hover) and in the utility bar (touch) — the
   *  app's screens inside the embed widget pass it, having no Nav to leave by. */
  onBack?: { label: string; go: () => void };
  /** Flips the mosaic's order (the app's `?order=newest`, toggled in its nav). The
   *  widget itself never sets this: its mosaic is always oldest first. */
  newestFirst?: boolean;
  /** Told whenever the view flips, so a host (the app's dataset view) can show the
   *  controls that only make sense in one of them — the order arrow, mosaic only. */
  onViewModeChange?: (mode: 'slideshow' | 'mosaic') => void;
}) {
  const [viewMode, setViewMode] = useState<'slideshow' | 'mosaic'>('slideshow');
  useEffect(() => {
    onViewModeChange?.(viewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);
  // What's actually drawn lags `viewMode` (which the switches read): flipping to the
  // mosaic mounts a tile per picture, and done in the same render as the click it held
  // the switch's knob still for a moment. The knob moves first; the view follows.
  const shownMode = useDeferredValue(viewMode);
  const [playMode, setPlayMode] = useState<PlayMode>('shuffle');
  const [order, setOrder] = useState<number[]>(() => buildOrder(ds.items, 'shuffle'));
  const [pos, setPos] = useState(0);
  // Set only while a next/prev transition is animating: the outgoing picture
  // (at `prevPos`) slides off in `dir` while the new current picture slides in.
  // `fromX` is how far a finger had already dragged the card when it let go (0 for
  // a button/keyboard step), so the animation carries on from where the finger
  // left it rather than jumping back to centre first.
  const [slide, setSlide] = useState<{ prevPos: number; dir: 1 | -1; fromX: number } | null>(null);
  // Set when a picture was opened by tapping its tile in the mosaic: that's a look at
  // one picture, not the shuffle slideshow, so there's no next/previous or switches —
  // just a Back button (top left) back to the mosaic exactly as it was left. The Mosaic stays
  // mounted underneath (hidden) so its zoom and pan survive; `mosaicSeen` mounts it
  // the first time it's asked for and keeps it, so a slideshow-only visitor never
  // pays for every tile loading.
  const [solo, setSolo] = useState(false);
  const [mosaicSeen, setMosaicSeen] = useState(false);
  useEffect(() => {
    if (shownMode === 'mosaic') setMosaicSeen(true);
  }, [shownMode]);
  const closeSolo = useCallback(() => {
    setSolo(false);
    setViewMode('mosaic');
  }, []);

  // The "genie": the picture grows out of the tile that was tapped and, on close,
  // shrinks back into it. The picture's frame is moved and clipped from the tile's
  // box (`originRef`, in this frame's own coordinates) to the whole frame — a uniform
  // scale so nothing stretches, with a clip that opens up as it grows, and a little
  // spring on the way out. Web Animations API, so it can be played in reverse and
  // knows when it's done. The Mosaic stays put beneath, which is what it lands on.
  const frameRef = useRef<HTMLDivElement>(null);
  const soloWrapRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const closingRef = useRef(false);

  function playGenie(direction: 'open' | 'close', onDone?: () => void) {
    const el = soloWrapRef.current;
    const o = originRef.current;
    const f = frameRef.current;
    if (!el || !o || !f || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDone?.();
      return;
    }
    const W = f.clientWidth;
    const H = f.clientHeight;
    const s = Math.max(o.w / W, o.h / H);
    const dx = o.x + o.w / 2 - W / 2;
    const dy = o.y + o.h / 2 - H / 2;
    const ix = Math.max(0, (W - o.w / s) / 2);
    const iy = Math.max(0, (H - o.h / s) / 2);
    const tile = { transform: `translate(${dx}px, ${dy}px) scale(${s})`, clipPath: `inset(${iy}px ${ix}px round ${8 / s}px)` };
    const full = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px round 0px)' };
    const opening = direction === 'open';
    const frames = opening ? [tile, full] : [full, tile];
    const anim = el.animate(frames, {
      duration: opening ? 460 : 340,
      easing: opening ? 'cubic-bezier(0.34, 1.25, 0.5, 1)' : 'cubic-bezier(0.55, 0, 0.3, 1)',
      fill: opening ? 'none' : 'forwards',
    });
    anim.onfinish = () => onDone?.();
  }

  useLayoutEffect(() => {
    if (solo) playGenie('open');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solo]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    playGenie('close', () => {
      closingRef.current = false;
      closeSolo();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeSolo]);

  useEffect(() => {
    if (!solo) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && requestClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [solo, requestClose]);

  const goTo = useCallback(
    (newPos: number, dir: 1 | -1, fromX = 0) => {
      if (order.length < 2 || slide || solo) return;
      setSlide({ prevPos: pos, dir, fromX });
      setPos(newPos);
    },
    [order.length, pos, slide, solo],
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

  // The mosaic is always oldest to newest (undated last), the dataset view's default
  // order, whatever the slideshow's shuffle switch says. `mosaicOrder[t]` is the
  // `ds.items` index of tile t.
  const mosaicOrder = useMemo(() => {
    const order = buildOrder(ds.items, 'chronological');
    return newestFirst ? order.reverse() : order;
  }, [ds.items, newestFirst]);
  const mosaicItems = useMemo(() => mosaicOrder.map((i) => ds.items[i]), [mosaicOrder, ds.items]);

  // Tapping a tile in the mosaic shows that picture on its own, no transition (see `solo`).
  const openItemIndex = useCallback(
    (tile: number, rect?: DOMRect) => {
      const f = frameRef.current?.getBoundingClientRect();
      originRef.current =
        rect && f ? { x: rect.left - f.left, y: rect.top - f.top, w: rect.width, h: rect.height } : null;
      const p = order.indexOf(mosaicOrder[tile]);
      setSlide(null);
      setPos(p === -1 ? 0 : p);
      setSolo(true);
      setViewMode('slideshow');
    },
    [order, mosaicOrder],
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
    if (swipedRef.current || animating || next === flipped || isDrawn(current)) return;
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
    if (viewMode !== 'slideshow' || order.length < 2 || solo) return;
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
  }, [pos, order, viewMode, ds.items, solo]);

  if (ds.items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-[var(--color-muted)]">
        {ds.topic} has no pictures yet.
      </div>
    );
  }

  const current = ds.items[order[pos]];
  // A solo picture (from the mosaic) has nowhere to browse to: no arrows, no switches.
  const canBrowse = ds.items.length > 1 && !solo;

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
    <div ref={frameRef} className="group relative min-h-0 flex-1">
      {/* Unlike the hover chrome, this stays on both sides of the card (and through the
          flip): it's the only way back to the mosaic. */}
      {solo && (
        <button
          onClick={requestClose}
          aria-label="Back to the mosaic"
          title="Back to the mosaic"
          className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-full bg-[var(--color-ink)]/70 py-1.5 pl-2 pr-3 text-xs text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)]"
        >
          <ChevronIcon direction="left" />
          Back
        </button>
      )}
      {!solo && onBack && (
        <button
          onClick={onBack.go}
          className={`absolute left-3 top-3 z-10 rounded-full bg-[var(--color-ink)]/70 px-3 py-1.5 text-xs text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
        >
          ← {onBack.label}
        </button>
      )}

      {/* Bottom right: two metal switches. Mosaic view on = every picture at once,
          off (the default) = one picture at a time; Shuffle on = random pass, off = oldest-first. */}
      {canBrowse && (
        <div className={`absolute bottom-3 right-3 z-10 flex items-center gap-3 rounded-full bg-[var(--color-ink)]/60 px-3 py-1.5 backdrop-blur ${chrome}`}>
          {viewMode === 'slideshow' && (
            <ShuffleButton on={playMode === 'shuffle'} onChange={(on) => switchPlayMode(on ? 'shuffle' : 'chronological')} />
          )}
          <MetalToggle
            label="Mosaic view"
            checked={viewMode === 'mosaic'}
            onChange={(on) => setViewMode(on ? 'mosaic' : 'slideshow')}
          />
        </div>
      )}

      {(mosaicSeen || shownMode === 'mosaic') && (
        <div className={viewMode === 'mosaic' || solo ? 'h-full w-full' : 'hidden'}>
          <Mosaic items={mosaicItems} onOpenItem={openItemIndex} />
        </div>
      )}
      {(shownMode !== 'mosaic' || solo) && (
        <>
          {/* The picture's frame, which the mosaic-to-picture animation moves (soloWrapRef). */}
          <div ref={soloWrapRef} className="absolute inset-0">
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
              className={`absolute inset-0 ${isDrawn(current) ? '' : 'embed-flip-perspective'} ${slide ? (slide.dir === 1 ? 'embed-slide-enter-next' : 'embed-slide-enter-prev') : ''}`}
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
              {isDrawn(current) ? (
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
                    className={`embed-flip-face embed-flip-face-back flex cursor-pointer flex-col overflow-y-auto bg-[var(--color-wall)] text-[var(--color-ink)] ${
                      canBrowse ? 'px-16 pb-14 pt-6' : 'p-6'
                    }`}
                  >
                    {/* Nudged right of the Back button (top left) when there is one. */}
                    <div className={solo ? 'pl-20' : onBack ? 'pt-8' : ''}>
                      <h2 className="serif text-xl leading-tight">{current.name || 'Untitled'}</h2>
                      <p className="mt-1 text-sm text-[var(--color-muted)]">
                        {[current.year ?? undefined, current.brand].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>

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
          </div>

          {!showingBack && current.text === undefined && (
            <div
              className={`absolute bottom-3 left-3 z-10 max-w-[70%] truncate rounded-full bg-[var(--color-ink)]/60 px-3 py-1 text-xs text-[var(--color-wall)] backdrop-blur ${chrome}`}
            >
              {current.name}
              {current.year ? ` · ${current.year}` : ''}
            </div>
          )}

          {canBrowse && (
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
          {onBack && !solo ? (
            <button
              onClick={onBack.go}
              aria-label={`Back to ${onBack.label}`}
              title={`Back to ${onBack.label}`}
              className="rounded-full p-1.5 hover:bg-white/10"
            >
              <ChevronIcon direction="left" />
            </button>
          ) : (
            <span />
          )}
          {!isDrawn(current) && !showingBack && viewMode === 'slideshow' && (
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
              aria-label={viewMode === 'slideshow' ? 'Slideshow — switch to mosaic' : 'Mosaic — switch to slideshow'}
              title={viewMode === 'slideshow' ? 'Slideshow' : 'Mosaic'}
              className="flex items-center gap-1.5 rounded-full border border-white/25 px-2.5 py-1 text-[11px] hover:bg-white/10 active:bg-white/15"
            >
              {viewMode === 'slideshow' ? <SingleIcon size={14} /> : <MosaicIcon size={14} />}
              {viewMode === 'slideshow' ? 'Slideshow' : 'Mosaic'}
            </button>
          )}
          {canBrowse && viewMode === 'slideshow' && (
            <ShuffleButton on={playMode === 'shuffle'} onChange={(on) => switchPlayMode(on ? 'shuffle' : 'chronological')} className="border border-white/25 hover:bg-white/10" />
          )}
        </div>
      </div>

      {canBrowse && viewMode === 'slideshow' ? (
        <button
          onClick={() => goNext()}
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

/** Items that are drawn from their own content rather than a picture, so have no back
 *  to flip to: a saved thread, an Instagram post, or plain text. */
function isDrawn(item: EmbedItem): boolean {
  return !!(item.tweet || item.instagram) || item.text !== undefined;
}

/** One item filling the frame: its picture, or — for a saved thread — the thread
 *  itself, read top to bottom, with the same X embeds the app's own wall opens. */
function Slide({ item }: { item: EmbedItem }) {
  if (!isDrawn(item)) {
    return <Photo src={item.image} alt={item.name} className="h-full w-full" sizes={SINGLE_SIZES} />;
  }
  return (
    <div
      className="tweet-scroll custom-scroll h-full w-full overflow-y-auto overscroll-contain bg-[var(--color-wall)] text-[var(--color-ink)]"
      style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}
    >
      <div className="space-y-3 p-4 sm:p-8">
        {item.text !== undefined ? (
          <TextView text={item.text} />
        ) : item.tweet ? (
          <TweetThreadList tweets={item.tweet.tweets} fallback={item} plain />
        ) : (
          /* Instagram's own embed — it plays the reel and swipes the carousel itself. */
          <InstagramPostView item={item} />
        )}
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
