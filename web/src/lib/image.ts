/** The physical-world "swap image" picker's default search query.
 *
 *  Prefers the curated `imageQuery` (brand + specific model/reference + year, per
 *  curation-rules.md (d)) over a bare name+brand — "Rolex Submariner" alone returns
 *  whatever version is most photographed today, not the specific one this item shows.
 *  Falls back to name+brand+year for items curated before `imageQuery` existed. */
export function physicalImageQuery(item: { name: string; brand: string; year: number | null; imageQuery?: string }): string {
  return item.imageQuery?.trim() || [item.name, item.brand, item.year].filter(Boolean).join(' ').trim();
}
