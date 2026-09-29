import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, Item } from '../../../shared/types';
import { ItemModal } from './ItemModal';
import { Photo } from './Photo';
import { TweetThreadList } from './TweetCard';
import { InstagramPostView } from './InstagramCard';
import { TextView } from './TextCard';

/** A Fisher-Yates pass, so nothing repeats until the whole set has been seen. */
function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The dataset one item at a time — the site's counterpart to the embed's slideshow
// (Embed.tsx's Browse), drawn the same way: the picture full-bleed, edge to edge, with
// prev/next and the caption appearing only on hover so the photo itself is never
// interrupted. `pool` arrives oldest-first (or newest-first), which is the Linear
// order; Shuffle plays a random pass instead. Flipping between the two stays on the
// item you're looking at. Arrow keys and a horizontal swipe step through; it wraps at
// either end.
export function Slideshow({
  ds,
  pool,
  shuffle,
  onChanged,
}: {
  ds: Dataset;
  pool: Item[];
  shuffle: boolean;
  onChanged: (ds: Dataset) => void;
}) {
  // Rebuilt only when the SET of items changes (or the mode flips), not on every edit
  // to one of them — an edit must not reshuffle the deck under the reader.
  const key = pool.map((i) => i.id).join(',');
  const order = useMemo(() => (shuffle ? shuffled(pool) : pool), [key, shuffle]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(pool.map((i) => [i.id, i])), [pool]);

  const [pos, setPos] = useState(0);
  const currentId = useRef<string | null>(null);
  // Mode flip or set change: stay on the same item if it still exists.
  useEffect(() => {
    const at = currentId.current ? order.findIndex((i) => i.id === currentId.current) : -1;
    setPos(at >= 0 ? at : 0);
  }, [order]);

  const n = order.length;
  const idx = Math.min(pos, Math.max(0, n - 1));
  const current = n ? byId.get(order[idx].id) ?? order[idx] : undefined;
  currentId.current = current?.id ?? null;

  const go = (d: number) => n > 1 && setPos((p) => (Math.min(p, n - 1) + d + n) % n);
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable]')) return;
      goRef.current(e.key === 'ArrowRight' ? 1 : -1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const touch = useRef<{ x: number; y: number } | null>(null);
  if (!current) return null;

  // Every control here (prev/next, the caption) lives in `group` and only shows on
  // hover — same as the embed's `chrome` — so the picture displays uninterrupted
  // otherwise.
  const chrome = 'opacity-0 pointer-events-none transition-opacity duration-150 group-hover:opacity-100 group-hover:pointer-events-auto';

  return (
    <div
      className="group relative h-[calc(100svh-11rem)] min-h-[16rem] w-full overflow-hidden bg-[var(--color-wall-soft)]"
      onTouchStart={(e) => {
        touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }}
      onTouchEnd={(e) => {
        const s = touch.current;
        touch.current = null;
        if (!s || (e.target as HTMLElement).closest('input, textarea, select, iframe')) return;
        const dx = e.changedTouches[0].clientX - s.x;
        const dy = e.changedTouches[0].clientY - s.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      {current.tweet || current.instagram || current.text !== undefined ? (
        /* A saved thread, an Instagram post or plain text: its own scrolling column, not a picture. */
        <div key={current.id} className="tweet-scroll custom-scroll h-full w-full overflow-y-auto overscroll-contain bg-[var(--color-card)]">
          <div className="mx-auto max-w-xl space-y-3 p-4 sm:p-8">
            {current.url && (
              <a
                href={current.url}
                target="_blank"
                rel="noreferrer"
                className="block text-right text-xs text-[var(--color-accent)] hover:underline"
              >
                {current.instagram ? 'Open on Instagram ↗' : 'Open on X ↗'}
              </a>
            )}
            {current.text !== undefined ? (
              <TextView text={current.text} />
            ) : current.tweet ? (
              <TweetThreadList tweets={current.tweet.tweets} fallback={current} />
            ) : (
              <InstagramPostView item={current} />
            )}
          </div>
        </div>
      ) : (
        <Slide key={current.id} ds={ds} item={current} onChanged={onChanged} />
      )}

      {!current.tweet && !current.instagram && current.text === undefined && (
        <div className={`absolute bottom-3 left-3 z-10 max-w-[70%] truncate rounded-full bg-[var(--color-ink)]/60 px-3 py-1 text-xs text-[var(--color-wall)] backdrop-blur ${chrome}`}>
          {current.name}
          {current.year ? ` · ${current.year}` : ''}
        </div>
      )}

      {n > 1 && (
        <>
          <button
            onClick={() => go(-1)}
            aria-label="Previous"
            title="Previous"
            className={`absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/60 p-2.5 text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            onClick={() => go(1)}
            aria-label="Next"
            title="Next"
            className={`absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-[var(--color-ink)]/60 p-2.5 text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)] ${chrome}`}
          >
            <ChevronIcon direction="right" />
          </button>
          <span className={`absolute bottom-3 right-3 z-10 rounded-full bg-[var(--color-ink)]/60 px-3 py-1 text-xs tabular-nums text-[var(--color-wall)] backdrop-blur ${chrome}`}>
            {idx + 1} / {n}
          </span>
        </>
      )}
    </div>
  );
}

// One picture, filling the frame edge to edge — same as the embed's own slide. A
// click turns it over to the item's details — description, fields, edit — which the
// close button (or Escape) turns back.
function Slide({ ds, item, onChanged }: { ds: Dataset; item: Item; onChanged: (ds: Dataset) => void }) {
  const [back, setBack] = useState(false);
  if (back) {
    return <ItemModal inline ds={ds} item={item} onClose={() => setBack(false)} onChanged={onChanged} />;
  }
  return (
    <button
      onClick={() => setBack(true)}
      aria-label={`${item.name || 'Item'} — show details`}
      title="Click for details"
      className="block h-full w-full cursor-pointer"
    >
      <Photo src={item.image} alt={item.name} className="h-full w-full" sizes="100vw" />
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
