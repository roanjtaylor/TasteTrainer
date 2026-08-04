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
