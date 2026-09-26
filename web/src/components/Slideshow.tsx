import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, Item } from '../../../shared/types';
import { ItemModal } from './ItemModal';
import { Photo } from './Photo';
import { TweetThreadList } from './TweetCard';

/** A Fisher-Yates pass, so nothing repeats until the whole set has been seen. */
function shuffled<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The dataset one item at a time — the site's counterpart to the embed's slideshow.
// `pool` arrives oldest-first (or newest-first), which is the Linear order; Shuffle plays
// a random pass instead. Flipping between the two stays on the item you're looking at.
// Arrow keys and a horizontal swipe step through; it wraps at either end.
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

  return (
    <div
      className="space-y-3"
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
      {current.tweet ? (
        <div key={current.id} className="mx-auto max-w-xl space-y-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4">
          {current.url && (
            <a
              href={current.url}
              target="_blank"
              rel="noreferrer"
              className="block text-right text-xs text-[var(--color-accent)] hover:underline"
            >
              Open on X ↗
            </a>
          )}
          <TweetThreadList tweets={current.tweet.tweets} fallback={current} />
        </div>
      ) : (
        <Slide key={current.id} ds={ds} item={current} onChanged={onChanged} />
      )}

      <div className="flex items-center justify-center gap-4 text-sm text-[var(--color-muted)]">
        <button
          onClick={() => go(-1)}
          disabled={n < 2}
          aria-label="Previous"
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 hover:bg-[var(--color-wall-soft)] disabled:opacity-40"
        >
          ←
        </button>
        <span className="tabular-nums">
          {idx + 1} / {n}
        </span>
        <button
          onClick={() => go(1)}
          disabled={n < 2}
          aria-label="Next"
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 hover:bg-[var(--color-wall-soft)] disabled:opacity-40"
        >
          →
        </button>
      </div>
    </div>
  );
}

// One picture, as large as the window allows: the front is just the image (the height is
// the window less the page chrome and the counter row, so it needs no scrolling), and a
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
      className="block h-[calc(100svh-11rem)] min-h-[16rem] w-full cursor-pointer overflow-hidden border border-[var(--color-line)] bg-[var(--color-wall-soft)]"
    >
      <Photo src={item.image} alt={item.name} sizes="100vw" />
    </button>
  );
}
