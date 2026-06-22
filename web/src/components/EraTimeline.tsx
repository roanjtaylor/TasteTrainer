import { useMemo } from 'react';
import type { Dataset } from '../../../shared/types';

export function EraTimeline({
  ds,
  onSelect,
}: {
  ds: Dataset;
  onSelect: (subtopicName: string) => void;
}) {
  const cards = useMemo(() => {
    const countByGroup = new Map<string, number>(ds.subtopics.map((s) => [s.name, 0]));
    const minYear = new Map<string, number>();
    const maxYear = new Map<string, number>();

    for (const item of ds.items) {
      countByGroup.set(item.subtopic, (countByGroup.get(item.subtopic) ?? 0) + 1);
      if (item.year != null) {
        const prev = minYear.get(item.subtopic);
        if (prev == null || item.year < prev) minYear.set(item.subtopic, item.year);
        const prevMax = maxYear.get(item.subtopic);
        if (prevMax == null || item.year > prevMax) maxYear.set(item.subtopic, item.year);
      }
    }

    return ds.subtopics.map((s) => ({
      name: s.name,
      description: s.description,
      count: countByGroup.get(s.name) ?? 0,
      earliest: minYear.get(s.name) ?? null,
      latest: maxYear.get(s.name) ?? null,
    }));
  }, [ds.subtopics, ds.items]);

  if (cards.length === 0) {
    return (
      <p className="text-[var(--color-muted)]">
        No subtopics yet — curate some to explore by theme.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => {
        const yearRange =
          c.earliest != null && c.latest != null
            ? c.earliest === c.latest
              ? `${c.earliest}`
              : `${c.earliest} – ${c.latest}`
            : null;

        return (
          <button
            key={c.name}
            onClick={() => onSelect(c.name)}
            className="flex flex-col items-start gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5 text-left shadow-sm transition-colors hover:bg-[var(--color-wall-soft)]"
          >
            <span className="serif text-xl leading-tight text-[var(--color-ink)]">{c.name}</span>
            <div className="flex items-center gap-3 text-sm text-[var(--color-muted)]">
              {yearRange && <span>{yearRange}</span>}
              <span>
                {c.count} {c.count === 1 ? 'item' : 'items'}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[var(--color-muted)]">{c.description}</p>
          </button>
        );
      })}
    </div>
  );
}
