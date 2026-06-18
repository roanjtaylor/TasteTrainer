import type { Item } from '../../../shared/types';

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
