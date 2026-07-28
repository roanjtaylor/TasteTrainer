import type { Item } from '../../../shared/types';
import { eraOf } from '../lib/format';
import { Photo } from './Photo';

// Gallery-style display card: the work is the hero, chrome stays quiet.
// When `onClick` is given the whole card is a button that opens the item for
// editing — not just a hover-only affordance, so it works on touch devices too.
export function ItemCard({ item, onClick }: { item: Item; onClick?: () => void }) {
  const body = (
    <>
      <div className="aspect-[4/3] w-full bg-[var(--color-wall-soft)]">
        <Photo src={item.image} alt={item.name} />
      </div>
      <div className="space-y-1.5 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="serif text-lg leading-tight">{item.name}</h3>
          <span className="shrink-0 text-sm text-[var(--color-muted)]">
            {item.year ?? '—'}
          </span>
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          {[item.brand, item.creator].filter(Boolean).join(' · ') || '—'}
        </p>
        <p className="text-sm leading-snug">{item.description}</p>
        {item.definingFact && (
          <p className="text-sm italic text-[var(--color-muted)]">{item.definingFact}</p>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Chip>{item.subtopic || 'unsorted'}</Chip>
          <Chip>{eraOf(item.year)}</Chip>
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="w-full overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] text-left cursor-pointer transition-colors hover:border-[var(--color-accent)]"
      >
        {body}
      </button>
    );
  }

  return (
    <figure className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
      {body}
    </figure>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-line)] bg-[var(--color-wall)] px-2.5 py-0.5 text-xs text-[var(--color-muted)]">
      {children}
    </span>
  );
}
