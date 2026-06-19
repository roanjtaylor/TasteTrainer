import type { Dataset, EraGroup, Item } from '../../../shared/types';

/** Era derived from year (mirror of the server's rule): decade bucket. */
export function eraOf(year: number | null): string {
  if (year == null || Number.isNaN(year)) return 'Unknown';
  return `${Math.floor(year / 10) * 10}s`;
}

/** Unique, sorted eras spanned by a set of items. */
export function erasOf(items: Item[]): string[] {
  const set = new Set(items.map((i) => eraOf(i.year)));
  return [...set].sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return parseInt(a) - parseInt(b);
  });
}

// ---- Era-groups (the named time periods for the Era filter timeline) ----

/** The dated year-span of a set of items, or null when nothing is dated. */
export function yearSpan(items: Item[]): { min: number; max: number } | null {
  const years = items.map((i) => i.year).filter((y): y is number => typeof y === 'number');
  if (!years.length) return null;
  return { min: Math.min(...years), max: Math.max(...years) };
}

/**
 * The era-groups to render: the dataset's AI-initialised `eraGroups` when present,
 * otherwise a century-bucket fallback derived from the items' span so the timeline
 * always works (decision 5 in the plan). Ranges are [start, end) and contiguous.
 */
export function eraGroupsOf(ds: Pick<Dataset, 'eraGroups' | 'items'>): EraGroup[] {
  if (ds.eraGroups && ds.eraGroups.length) {
    return [...ds.eraGroups].sort((a, b) => a.start - b.start);
  }
  const span = yearSpan(ds.items);
  if (!span) return [];
  const firstCentury = Math.floor(span.min / 100) * 100;
  const lastCentury = Math.floor(span.max / 100) * 100;
  const groups: EraGroup[] = [];
  for (let c = firstCentury; c <= lastCentury; c += 100) {
    groups.push({ label: `${c}s`, start: c, end: c + 100 });
  }
  return groups;
}

/** Decade strings within an era-group's [start, end) range — maps a group to backend era scope. */
export function decadesInRange(start: number, end: number): string[] {
  const first = Math.floor(start / 10) * 10;
  const out: string[] = [];
  for (let d = first; d < end; d += 10) out.push(`${d}s`);
  return out;
}

/** Items whose year falls in an era-group's [start, end) range. */
export function itemsInGroup(items: Item[], group: EraGroup): Item[] {
  return items.filter((i) => i.year != null && i.year >= group.start && i.year < group.end);
}

/** A representative "key work" to pin for an era-group: its first dated item with an image. */
export function keyWorkOf(items: Item[], group: EraGroup): Item | null {
  const inGroup = itemsInGroup(items, group).sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  return inGroup.find((i) => i.image) ?? inGroup[0] ?? null;
}

/** Works-per-decade counts across the items' span — drives the timeline line graph. */
export function decadeCounts(items: Item[]): { decade: number; count: number }[] {
  const span = yearSpan(items);
  if (!span) return [];
  const first = Math.floor(span.min / 10) * 10;
  const last = Math.floor(span.max / 10) * 10;
  const counts = new Map<number, number>();
  for (let d = first; d <= last; d += 10) counts.set(d, 0);
  for (const it of items) {
    if (it.year == null) continue;
    const d = Math.floor(it.year / 10) * 10;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([decade, count]) => ({ decade, count }));
}
