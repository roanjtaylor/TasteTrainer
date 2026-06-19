// The SUBTOPIC view of the Filters subpage (6-ui.md): each subtopic reads as a
// *collection*, not a word — its first few items spread like a hand of cards (a fan),
// with a "+N more" badge for the rest. The whole card drills into that subtopic.
import type { Dataset, Item } from '../../../shared/types';
import { Photo } from './Photo';

export function SubtopicFans({
  ds,
  onSelect,
}: {
  ds: Dataset;
  onSelect: (subtopic: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
      {ds.subtopics.map((s) => {
        const items = ds.items.filter((i) => i.subtopic === s.name);
        return (
          <button
            key={s.name}
            onClick={() => onSelect(s.name)}
            className="group rounded-2xl p-2 text-left transition-transform hover:-translate-y-0.5"
          >
            <Fan items={items} />
            <div className="mt-3 px-1">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="serif text-lg leading-tight group-hover:text-[var(--color-accent)]">
                  {s.name}
                </h3>
                <span className="shrink-0 text-sm text-[var(--color-muted)]">
                  {items.length} {items.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <p className="mt-0.5 text-sm leading-snug text-[var(--color-muted)]">{s.description}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// At most 3 cards, fanned out from a shared bottom hinge; a 4th "+N more" badge stands
// in for the remainder. On hover the spread widens slightly so it feels like a hand.
function Fan({ items }: { items: Item[] }) {
  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  const n = shown.length;

  if (n === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-[var(--color-line)] text-xs text-[var(--color-muted)]">
        no items yet
      </div>
    );
  }

  return (
    <div className="relative flex h-48 items-end justify-center">
      {shown.map((it, i) => {
        const center = (n - 1) / 2;
        const offset = i - center; // -1, 0, 1 for a full hand
        const rotate = offset * 11;
        const x = offset * 38;
        return (
          <div
            key={it.id}
            className="absolute bottom-0 h-44 w-32 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-sm transition-transform duration-200"
            style={{
              transform: `translateX(${x}px) rotate(${rotate}deg)`,
              transformOrigin: 'bottom center',
              zIndex: i,
            }}
          >
            <Photo src={it.image} alt={it.name} />
          </div>
        );
      })}
      {more > 0 && (
        <span className="absolute bottom-2 right-2 z-10 rounded-full bg-[var(--color-ink)]/80 px-2.5 py-0.5 text-xs text-[var(--color-wall)]">
          +{more} more
        </span>
      )}
    </div>
  );
}
