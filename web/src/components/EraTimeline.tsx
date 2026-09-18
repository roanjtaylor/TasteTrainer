import { useMemo } from 'react';
import type { Dataset, EraGroup } from '../../../shared/types';
import { decadeCounts, eraGroupsOf, itemsInGroup, keyWorkOf } from '../lib/format';
import { Photo } from './Photo';

// The ERA view of the Filters subpage (6-ui.md decision 5): a works-per-decade line
// over a band of named era-periods, each period pinning one key work.
//
// This file used to render *subtopics* despite its name, which left the era axis
// unreachable from the UI even though `eraGroups` was generated on every save and
// the backend could already scope by era. That mattered most for the digital world,
// where time — not maker — is the axis the field is actually organised by.
//
// The x-scale is BANDED: every period gets an equal slot regardless of how many
// years it spans, so a period's slice of the graph and its pinned work sit directly
// above its button. Recent design history packs many short periods; proportional
// widths would crush their labels to nothing. Year ranges are printed per band, so
// the real span is never lost — only the width stops encoding it.
export function EraTimeline({
  ds,
  onSelect,
}: {
  ds: Dataset;
  onSelect: (group: EraGroup) => void;
}) {
  const groups = useMemo(() => eraGroupsOf(ds), [ds]);

  const bands = useMemo(
    () =>
      groups.map((g) => {
        const inGroup = itemsInGroup(ds.items, g);
        // Counts per decade WITHIN this band, so the line has shape inside a period
        // rather than one flat step per era.
        const decades = decadeCounts(inGroup);
        return { group: g, count: inGroup.length, decades, keyWork: keyWorkOf(ds.items, g) };
      }),
    [groups, ds.items],
  );

  if (!bands.length) {
    return (
      <p className="text-[var(--color-muted)]">
        No dated items yet — add some with a year and the timeline will appear.
      </p>
    );
  }

  const peak = Math.max(1, ...bands.flatMap((b) => b.decades.map((d) => d.count)), 1);

  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-full gap-1" style={{ minWidth: `${bands.length * 150}px` }}>
        {bands.map((b) => (
          <button
            key={`${b.group.label}-${b.group.start}`}
            onClick={() => onSelect(b.group)}
            className="group flex flex-1 flex-col rounded-xl border border-transparent p-2 text-left transition-colors hover:border-[var(--color-line)] hover:bg-[var(--color-wall-soft)]"
          >
            {/* Pinned key work — what this period actually looks like. */}
            <div className="h-28 w-full overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
              {b.keyWork ? (
                <Photo src={b.keyWork.image} alt={b.keyWork.name} sizes="250px" />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-[var(--color-muted)]">
                  no work yet
                </div>
              )}
            </div>

            {/* Works-per-decade within the period. Bars, not a polyline: a band can
                hold a single decade, and a one-point line draws nothing. */}
            <div className="mt-2 flex h-10 items-end gap-0.5">
              {b.decades.length ? (
                b.decades.map((d) => (
                  <div
                    key={d.decade}
                    title={`${d.decade}s — ${d.count} ${d.count === 1 ? 'work' : 'works'}`}
                    className="flex-1 rounded-sm bg-[var(--color-accent)]/70 group-hover:bg-[var(--color-accent)]"
                    style={{ height: `${Math.max(6, (d.count / peak) * 100)}%` }}
                  />
                ))
              ) : (
                <div className="h-px w-full bg-[var(--color-line)]" />
              )}
            </div>

            <div className="mt-2 border-t border-[var(--color-line)] pt-2">
              <div className="serif text-sm leading-tight group-hover:text-[var(--color-accent)]">
                {b.group.label}
              </div>
              <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                {b.group.start}–{b.group.end - 1} · {b.count} {b.count === 1 ? 'work' : 'works'}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
