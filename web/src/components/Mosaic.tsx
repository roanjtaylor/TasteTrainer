import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { EmbedItem } from '../../../shared/types';
import { Photo } from './Photo';

const TILE = 220; // px, at scale 1 — the mosaic's native grid unit.

/** A saved thread's tile: its words are its picture (as on the app's wall, TweetCard). */
function TweetTile({ item }: { item: EmbedItem }) {
  const tweets = item.tweet?.tweets ?? [];
  const lead = tweets.find((t) => !t.context) ?? tweets[0];
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden bg-[var(--color-card)] p-4 text-left">
      <p className="truncate text-xs text-[var(--color-muted)]">
        {lead?.authorName || (lead?.author ? `@${lead.author}` : item.name)}
      </p>
      <p className="serif min-h-0 flex-1 overflow-hidden whitespace-pre-line text-[15px] leading-snug text-[var(--color-ink)]">
        {lead?.text ?? item.name}
      </p>
    </div>
  );
}

/**
 * A zoomable, pannable grid of every picture in the dataset at once — "a portal"
 * onto the whole field rather than one picture at a time (Embed.tsx's other mode,
 * Browse/shuffle). Laid out as close to a square as the item count allows, so it
 * reads as one big image made of many, not a list.
 *
 * No pan/zoom library: this is the only place in the app that needs it, and a
 * few hundred lines of pointer-event math is cheaper than a dependency for one
 * screen. Pointer Events (not separate mouse/touch handlers) so drag-to-pan and
 * two-finger pinch-to-zoom share one code path.
 */
export function Mosaic({
  items,
  onOpenItem,
}: {
  items: EmbedItem[];
  /** `rect` is the tapped tile's box on screen, for animating out of it. */
  onOpenItem: (index: number, rect?: DOMRect) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });
  const [transitioning, setTransitioning] = useState(false);
  // Mirrors `transform` for the native wheel listener below, which is created once
  // per `zoomAt` identity and would otherwise read a stale scale from its closure.
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const cols = Math.max(1, Math.ceil(Math.sqrt(items.length)));
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const contentW = cols * TILE;
  const contentH = rows * TILE;

  // The scale that fits the whole mosaic in the viewport — both the resting state
  // on open and the floor you can't zoom out past (there's nothing more to see).
  const fitScale = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return 0.3;
    return Math.min(vp.clientWidth / contentW, vp.clientHeight / contentH);
  }, [contentW, contentH]);

  const centerRect = useCallback(
    (scale: number) => {
      const vp = viewportRef.current;
      if (!vp) return { x: 0, y: 0 };
      return {
        x: (vp.clientWidth - contentW * scale) / 2,
        y: (vp.clientHeight - contentH * scale) / 2,
      };
    },
    [contentW, contentH],
  );

  // Fit-and-centre on mount and whenever the item count reshapes the grid.
  useEffect(() => {
    const scale = fitScale();
    setTransform({ scale, ...centerRect(scale) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols, rows]);

  const clamp = useCallback(
    (t: { scale: number; x: number; y: number }) => {
      const vp = viewportRef.current;
      const min = fitScale() * 0.7;
      const max = fitScale() * 8;
      const scale = Math.min(max, Math.max(min, t.scale));
      if (!vp) return { scale, x: t.x, y: t.y };
      // Keep at least a sliver of the mosaic on screen — never let it drag away
      // entirely, but don't hard-lock it centred either (it's a "move around" view).
      const margin = 80;
      const minX = -(contentW * scale) + margin;
      const maxX = vp.clientWidth - margin;
      const minY = -(contentH * scale) + margin;
      const maxY = vp.clientHeight - margin;
      return {
        scale,
        x: Math.min(maxX, Math.max(minX, t.x)),
        y: Math.min(maxY, Math.max(minY, t.y)),
      };
    },
    [contentW, contentH, fitScale],
  );

  // ---- Pointer tracking: one pointer pans, two pinch-zoom. Shared by mouse,
  // touch, and pen since Pointer Events unify them. ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<null | { mode: 'pan'; startX: number; startY: number; origin: { x: number; y: number } } | { mode: 'pinch'; startDist: number; startScale: number; midpoint: { x: number; y: number } }>(null);
  const dragMoved = useRef(0);
  const downItem = useRef<number | null>(null);
  const downEl = useRef<HTMLElement | null>(null);

  function viewportPoint(e: { clientX: number; clientY: number }) {
    const vp = viewportRef.current!.getBoundingClientRect();
    return { x: e.clientX - vp.left, y: e.clientY - vp.top };
  }

  function onPointerDown(e: ReactPointerEvent, itemIndex?: number) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragMoved.current = 0;
    downItem.current = itemIndex ?? null;
    downEl.current = itemIndex === undefined ? null : (e.currentTarget as HTMLElement);

    if (pointers.current.size === 1) {
      gesture.current = { mode: 'pan', startX: e.clientX, startY: e.clientY, origin: { x: transform.x, y: transform.y } };
    } else if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const mid = viewportPoint({ clientX: (pts[0].x + pts[1].x) / 2, clientY: (pts[0].y + pts[1].y) / 2 });
      gesture.current = { mode: 'pinch', startDist: dist || 1, startScale: transform.scale, midpoint: mid };
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.mode === 'pan' && pointers.current.size === 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      dragMoved.current = Math.max(dragMoved.current, Math.hypot(dx, dy));
      setTransform((t) => clamp({ scale: t.scale, x: g.origin.x + dx, y: g.origin.y + dy }));
    } else if (g.mode === 'pinch' && pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      dragMoved.current = 999; // a pinch is never a tap
      const nextScale = g.startScale * (dist / g.startDist);
      zoomAt(g.midpoint, nextScale, true);
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      // A near-still pointer-down/up on a tile is a tap: open that picture. A real
      // drag (panning) must never also open one.
      if (dragMoved.current < 6 && downItem.current !== null) {
        onOpenItem(downItem.current, downEl.current?.getBoundingClientRect());
      }
      downItem.current = null;
    } else if (pointers.current.size === 1) {
      const p = Array.from(pointers.current.values())[0];
      gesture.current = { mode: 'pan', startX: p.x, startY: p.y, origin: { x: transform.x, y: transform.y } };
    }
  }

  // Zoom toward a viewport point (cursor or pinch midpoint), keeping the content
  // under it fixed — the usual "zoom at the mouse" feel, not zoom-from-centre.
  const transitionTimer = useRef<number | undefined>(undefined);
  const zoomAt = useCallback(
    (point: { x: number; y: number }, nextScaleRaw: number, animate = false) => {
      setTransform((t) => {
        const contentX = (point.x - t.x) / t.scale;
        const contentY = (point.y - t.y) / t.scale;
        const clamped = clamp({ scale: nextScaleRaw, x: 0, y: 0 });
        const nextScale = clamped.scale;
        const next = {
          scale: nextScale,
          x: point.x - contentX * nextScale,
          y: point.y - contentY * nextScale,
        };
        return clamp(next);
      });
      if (animate) {
        setTransitioning(true);
        window.clearTimeout(transitionTimer.current);
        transitionTimer.current = window.setTimeout(() => setTransitioning(false), 180);
      }
    },
    [clamp],
  );

  // A native (not React synthetic) listener: React attaches wheel handlers as
  // passive by default, which silently drops preventDefault and lets the page
  // scroll instead of zooming.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const point = { x: e.clientX - vp.getBoundingClientRect().left, y: e.clientY - vp.getBoundingClientRect().top };
      const factor = Math.exp(-e.deltaY * 0.0015);
      zoomAt(point, transformRef.current.scale * factor);
    };
    vp.addEventListener('wheel', handler, { passive: false });
    return () => vp.removeEventListener('wheel', handler);
  }, [zoomAt]);

  const grid = useMemo(
    () =>
      items.map((item, i) => ({
        item,
        i,
        left: (i % cols) * TILE,
        top: Math.floor(i / cols) * TILE,
      })),
    [items, cols],
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--color-wall)]">
      <div
        ref={viewportRef}
        className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            width: contentW,
            height: contentH,
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
            transition: transitioning ? 'transform 180ms ease-out' : undefined,
          }}
        >
          {grid.map(({ item, i, left, top }) => (
            <button
              key={item.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPointerDown(e, i);
              }}
              className="absolute cursor-pointer overflow-hidden border border-black/20"
              style={{ left, top, width: TILE, height: TILE }}
              aria-label={item.name}
              title={item.name}
            >
              {/* Sized to the tile, not to the zoom: every tile loads at once here, so a
                  thumbnail each is the whole budget. Tapping one opens it full-size. */}
              {item.tweet ? (
                <TweetTile item={item} />
              ) : (
                <Photo src={item.image} alt={item.name} className="h-full w-full" sizes={`${TILE}px`} />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
