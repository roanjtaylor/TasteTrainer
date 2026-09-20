import type { Item } from '../../../shared/types';
import { CaptureBadge } from './CaptureBadge';
import { Photo } from './Photo';

// Gallery-style display card: the image is the whole card by default, with its name
// and year permanently overlaid, bottom-left. Clicking the image expands the rest
// (creator, description, fun fact) below it — so browsing a dataset reads as a wall
// of images, and any one item's full record is a click away rather than always on
// screen. "Swap image" and "Edit" only appear once expanded, as small icon buttons
// sitting on the creator/brand line rather than a row of their own, so they don't
// leave blank space above the text.
//
// `expanded`/`onToggle` are controlled by the grid (Browse in DatasetView.tsx) rather
// than owned here, so it can keep only one card open across the whole wall of images.
export function ItemCard({
  item,
  expanded,
  onToggle,
  onEdit,
  onSwapImage,
}: {
  item: Item;
  expanded: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onSwapImage?: () => void;
}) {
  return (
    <figure className="group overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={expanded}
        aria-label={expanded ? 'Hide details' : 'Show details'}
        className="relative aspect-[4/3] w-full cursor-pointer bg-[var(--color-wall-soft)]"
      >
        <Photo src={item.image} alt={item.name} />
        <CaptureBadge capture={item.capture} year={item.year} />
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 transition-opacity duration-150 ${
            expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="flex items-baseline justify-between gap-2 text-white">
            <h3 className="serif truncate text-base leading-tight">{item.name}</h3>
            <span className="shrink-0 text-sm text-white/80">{item.year ?? '—'}</span>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="space-y-1.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--color-muted)]">
              {[item.brand, item.creator].filter(Boolean).join(' · ') || '—'}
            </p>
            {(onSwapImage || onEdit) && (
              <div className="flex shrink-0 items-center gap-1">
                {onSwapImage && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSwapImage();
                    }}
                    aria-label="Swap image"
                    title="Swap image"
                    className="rounded-full bg-[var(--color-ink)]/80 p-1.5 text-[var(--color-wall)]"
                  >
                    <ImageIcon />
                  </button>
                )}
                {onEdit && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit();
                    }}
                    aria-label="Edit"
                    title="Edit"
                    className="rounded-full bg-[var(--color-ink)]/80 p-1.5 text-[var(--color-wall)]"
                  >
                    <PenIcon />
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="text-sm leading-snug">{item.description}</p>
          {item.definingFact && (
            <p className="text-sm italic text-[var(--color-muted)]">{item.definingFact}</p>
          )}
        </div>
      )}
    </figure>
  );
}

function PenIcon() {
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

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 16-5.5-5.5L5 20" />
    </svg>
  );
}
