import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Item } from '../../../shared/types';
import { playGenie } from '../lib/genie';
import { TweetThreadList } from './TweetCard';

// The full-screen view a tweet tile's click opens — a saved thread's counterpart to
// ItemModal, grown out of the clicked tile with the same genie effect (lib/genie.ts)
// the embed's mosaic opens a picture with, instead of the old behaviour of unfolding
// the thread in place among the other tiles.
export function TweetModal({
  item,
  onClose,
  onEdit,
  originRect,
}: {
  item: Item;
  onClose: () => void;
  /** Personal-world editing, same as ItemModal's. */
  onEdit?: () => void;
  /** The clicked tile's own on-screen box — the panel grows out of it and shrinks
   *  back into it on close. */
  originRect?: DOMRect;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);

  useLayoutEffect(() => {
    if (!originRect || !panelRef.current) return;
    const o = originRect;
    playGenie(
      panelRef.current,
      { x: o.left, y: o.top, w: o.width, h: o.height },
      { w: window.innerWidth, h: window.innerHeight },
      'open',
    );
    // Runs once, on mount only — this instance is only ever rendered for one open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestClose() {
    if (!originRect || !panelRef.current || closingRef.current) {
      onClose();
      return;
    }
    closingRef.current = true;
    const o = originRect;
    playGenie(
      panelRef.current,
      { x: o.left, y: o.top, w: o.width, h: o.height },
      { w: window.innerWidth, h: window.innerHeight },
      'close',
      () => {
        closingRef.current = false;
        onClose();
      },
    );
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={requestClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={item.name || 'Thread'}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full max-h-[42rem] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-line)] px-4 py-2.5">
          <button onClick={requestClose} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
            ← Close
          </button>
          <div className="flex items-center gap-3 text-xs">
            {onEdit && (
              <button onClick={onEdit} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                Edit
              </button>
            )}
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] hover:underline">
                Open on X ↗
              </a>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TweetThreadList tweets={item.tweet?.tweets ?? []} fallback={item} />
        </div>
      </div>
    </div>
  );
}
