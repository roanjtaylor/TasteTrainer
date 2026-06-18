import { randomUUID } from 'node:crypto';

export const newId = (): string => randomUUID();
export const now = (): string => new Date().toISOString();

/**
 * Era is DERIVED from year, never stored (2-data.md). Default bucket = decade.
 * Returns e.g. "1990s", or "Unknown" when year is missing.
 */
export function eraOf(year: number | null | undefined): string {
  if (year == null || Number.isNaN(year)) return 'Unknown';
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
}

/** Unique, sorted list of decade-eras spanned by a set of years. */
export function erasOf(years: Array<number | null>): string[] {
  const set = new Set(years.map(eraOf));
  return [...set].sort((a, b) => {
    if (a === 'Unknown') return 1;
    if (b === 'Unknown') return -1;
    return parseInt(a) - parseInt(b);
  });
}
