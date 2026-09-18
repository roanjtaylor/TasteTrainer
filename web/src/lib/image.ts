// ---- Right-sized images ----
//
// `Item.image` is one URL, stored at whatever size curation found it — for Wikimedia
// (most of the app's pictures) that's a 960px or 3840px thumbnail, or the untouched
// original. A 220px mosaic tile or a 400px card downloading and DECODING that is where
// the embed's and the grid's cost went: a 3840px JPEG is ~40MB of bitmap once decoded,
// per picture. Wikimedia serves any file at a fixed ladder of widths from the same URL
// shape, so the fix is a `srcset` of those and letting the browser pick by slot size.
//
// Only Wikimedia is rewritten. mshots 403s on any size but the one it was captured at
// (and is ~30KB already); every other host is an arbitrary site with no resize API.

/** Wikimedia only serves these widths (w.wiki/GHai) — anything else is a 400. */
const WIKIMEDIA_WIDTHS = [250, 500, 960, 1280, 1920];

const WIKIMEDIA_THUMB = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+\/thumb\/.+\/[^/]*?)(\d+)(px-[^/]+)$/;
const WIKIMEDIA_ORIGINAL = /^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/([0-9a-f]\/[0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png))$/i;

/**
 * A `srcset` of smaller versions of `src`, or undefined when the host can't resize.
 * Never offers a width above the stored one: that is the most the file is known to
 * support, and asking Wikimedia to upscale is an error, not a bigger picture.
 */
export function thumbSrcSet(src: string): string | undefined {
  const thumb = src.match(WIKIMEDIA_THUMB);
  if (thumb) {
    const [, before, width, after] = thumb;
    const stored = Number(width);
    const smaller = WIKIMEDIA_WIDTHS.filter((w) => w < stored);
    if (!smaller.length) return undefined;
    return [...smaller.map((w) => `${before}${w}${after} ${w}w`), `${src} ${stored}w`].join(', ');
  }
  const original = src.match(WIKIMEDIA_ORIGINAL);
  if (original) {
    const [, base, hash, file] = original;
    // The original's own width is unknown, so it sits above the ladder as the pick
    // for a slot bigger than any thumbnail — which is what it was already serving.
    return [
      ...WIKIMEDIA_WIDTHS.filter((w) => w <= 1280).map((w) => `${base}/thumb/${hash}/${file}/${w}px-${file} ${w}w`),
      `${src} 2560w`,
    ].join(', ');
  }
  return undefined;
}

/** The physical-world "swap image" picker's default search query.
 *
 *  Prefers the curated `imageQuery` (brand + specific model/reference + year, per
 *  curation-rules.md (d)) over a bare name+brand — "Rolex Submariner" alone returns
 *  whatever version is most photographed today, not the specific one this item shows.
 *  Falls back to name+brand+year for items curated before `imageQuery` existed. */
export function physicalImageQuery(item: { name: string; brand: string; year: number | null; imageQuery?: string }): string {
  return item.imageQuery?.trim() || [item.name, item.brand, item.year].filter(Boolean).join(' ').trim();
}
