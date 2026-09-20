import type { Item } from '../../../shared/types';
import { CaptureBadge } from './CaptureBadge';
import { Photo } from './Photo';

// Gallery-style display card: nothing but the image, with its name and year on a
// hover overlay, bottom-left. Everything else about the item — the rest of its
// fields, "Swap image", "Edit" — lives in the full-screen modal a click opens
// (ItemModal.tsx), not appended below the card itself: growing the card in place
// used to break up the mosaic every time you looked at one item, leaving a hole in
// the wall exactly where your eye was. `onOpen` is owned by the grid (Browse in
// DatasetView.tsx), which is what decides which item's modal is open.
export function ItemCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  return (
    <figure className="group overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)]">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
        aria-haspopup="dialog"
        aria-label={`View ${item.name || 'item'}`}
        className="relative aspect-[4/3] w-full cursor-pointer bg-[var(--color-wall-soft)]"
      >
        <Photo src={item.image} alt={item.name} />
        <CaptureBadge capture={item.capture} year={item.year} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <div className="flex items-baseline justify-between gap-2 text-white">
            <h3 className="serif truncate text-base leading-tight">{item.name}</h3>
            <span className="shrink-0 text-sm text-white/80">{item.year ?? '—'}</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function PenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"
      />
    </svg>
  );
}

export function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 16-5.5-5.5L5 20" />
    </svg>
  );
}
