// Image sourcing (4-images.md): Wikimedia/Wikipedia as the default lead image,
// plus an unofficial DuckDuckGo image search that powers the 3x3 swap picker.
// URLs only — nothing is downloaded (2-data.md).
import { renderAndStore } from './screenshotRender.ts';

const UA =
  'TasteTrainer/0.1 (personal local tool; https://example.local) Node fetch';

/** Resolve a Wikipedia title to its lead-image URL at display quality, or "" if none.
 *
 *  Uses the MediaWiki Action API with `pithumbsize=800` so Wikimedia generates and
 *  caches a thumbnail at roughly 800 px. The returned URL is guaranteed to resolve —
 *  unlike manually-constructed /thumb/ paths, which 4xx when that size isn't cached.
 *  Falls back to the REST v1 summary thumbnail/original if the Action API gives nothing. */
export async function wikimediaImage(title: string): Promise<string> {
  if (!title) return '';
  const slug = encodeURIComponent(title.replace(/\s+/g, '_'));

  // Primary: Action API — triggers thumbnail generation at the requested size.
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&titles=${slug}&prop=pageimages&pithumbsize=800&format=json&formatversion=2&redirects=1`,
      { headers: { 'User-Agent': UA, accept: 'application/json' } },
    );
    if (res.ok) {
      const data: any = await res.json();
      const pages: any[] = data?.query?.pages ?? [];
      const thumb = pages[0]?.thumbnail?.source as string | undefined;
      if (thumb) return thumb;
    }
  } catch { /* fall through */ }

  // Fallback: REST v1 summary (pre-generated thumbnail, usually ~320 px).
  try {
    const res = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${slug}`,
      { headers: { 'User-Agent': UA, accept: 'application/json' } },
    );
    if (!res.ok) return '';
    const data: any = await res.json();
    return (data?.thumbnail?.source ?? data?.originalimage?.source) || '';
  } catch {
    return '';
  }
}

/**
 * First N image results from DuckDuckGo for a query (default 9 -> the 3x3 picker).
 * Unofficial endpoint: fetch a vqd token, then hit i.js. DuckDuckGo changes this
 * scrape's shape often, so a broken/empty result here is expected — falls through
 * to Wikimedia Commons search so the picker is never left with nothing to show.
 */
async function duckDuckGoImages(queryText: string, limit: number): Promise<string[]> {
  const q = encodeURIComponent(queryText);
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Referer: 'https://duckduckgo.com/',
  };

  // 1. Token.
  let vqd = '';
  try {
    const tokenRes = await fetch(`https://duckduckgo.com/?q=${q}&iax=images&ia=images`, {
      headers,
    });
    const html = await tokenRes.text();
    const m =
      html.match(/vqd="([^"]+)"/) ||
      html.match(/vqd=([\d-]+)&/) ||
      html.match(/vqd=([^&]+)&/);
    vqd = m?.[1] ?? '';
  } catch {
    return [];
  }
  if (!vqd) return [];

  // 2. Results.
  try {
    const res = await fetch(
      `https://duckduckgo.com/i.js?l=us-en&o=json&q=${q}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`,
      { headers: { ...headers, accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    const results: any[] = data?.results ?? [];
    return results
      .map((r) => r.image as string)
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** Fallback image source: Wikimedia Commons search. Official, stable JSON API
 *  (no scraping), so it's what keeps the picker working when the DuckDuckGo
 *  scrape above breaks. */
async function commonsImages(queryText: string, limit: number): Promise<string[]> {
  const q = encodeURIComponent(queryText);
  try {
    const res = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url&iiurlwidth=800&format=json&formatversion=2`,
      { headers: { 'User-Agent': UA, accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const data: any = await res.json();
    const pages: any[] = data?.query?.pages ?? [];
    return pages
      .map((p) => p?.imageinfo?.[0]?.thumburl as string | undefined)
      .filter(Boolean)
      .slice(0, limit) as string[];
  } catch {
    return [];
  }
}

export async function searchImages(queryText: string, limit = 9): Promise<string[]> {
  const q = queryText.trim();
  if (!q) return [];
  const primary = await duckDuckGoImages(q, limit);
  if (primary.length) return primary;
  return commonsImages(q, limit);
}

// ---- Software domain: screenshots (7-software-design.md) ----
//
// A website has no pre-existing hosted photo the way a physical object does on
// Wikimedia, so the "image" has to be generated. Two hops, mirroring the
// wikimediaImage() pattern above:
//   1. Resolve WHICH page to capture — the live url, or (for a past year) the
//      closest Wayback Machine snapshot, via the CDX API.
//   2. Turn that page url into an image url via mshots — a free, no-key,
//      URL-in/image-out screenshot service — so `item.image` is still just a
//      link (2-data.md #3), never a downloaded file.
// mshots renders asynchronously: the first hit can return a "generating…"
// placeholder before the real screenshot is ready moments later. Accepted,
// documented risk (7-software-design.md) — same posture as the DuckDuckGo call
// above; the picker's "Swap image" flow is the retry path.

const MSHOTS_BASE = 'https://s.wordpress.com/mshots/v1/';

function mshotsUrl(pageUrl: string, w = 1200, h = 900): string {
  return `${MSHOTS_BASE}${encodeURIComponent(pageUrl)}?w=${w}&h=${h}`;
}

function waybackPageUrl(url: string, timestamp: string): string {
  // `if_` renders the archived page standalone, without the Wayback toolbar.
  return `https://web.archive.org/web/${timestamp}if_/${url}`;
}

/** Claude doesn't always return a bare url with a scheme despite the prompt's example —
 *  a protocol-less "stripe.com" breaks both the CDX lookup and mshots. Cheap, high-value fix. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//i, '').split('/')[0];
  }
}

interface WaybackHit {
  timestamp: string;
  year: number;
}

/** Snapshots within [fromYear, toYear] in the CDX index. `matchType: 'domain'` matches
 *  ANY path on the host rather than requiring the exact url — the fix for cases like a
 *  Tesla product page where the exact path was never archived but the site clearly was.
 *  Closest-first is NOT guaranteed by the API — caller sorts. [] on any failure. */
async function waybackHits(
  target: string,
  fromYear: number,
  toYear: number,
  limit: number,
  matchType: 'exact' | 'domain' = 'exact',
): Promise<WaybackHit[]> {
  try {
    const res = await fetch(
      `http://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json` +
        `&from=${fromYear}0101&to=${toYear}1231&filter=statuscode:200&collapse=timestamp:6&limit=${limit * 3}` +
        (matchType === 'domain' ? '&matchType=domain' : ''),
      { headers: { 'User-Agent': UA } },
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as any[];
    // First row is the column header (["urlkey","timestamp","original",...]); skip it.
    return rows
      .slice(1)
      .map((r) => {
        const timestamp = String(r[1] ?? '');
        const year = Number(timestamp.slice(0, 4));
        return { timestamp, year };
      })
      .filter((h) => h.timestamp && Number.isFinite(h.year));
  } catch {
    return [];
  }
}

/** Exact-url match first (most specific — the actual page); if that's empty, fall back
 *  to any capture of the whole domain in the window (broader, but real sites are far
 *  better archived at the domain level than any one deep path). */
async function findWaybackHits(url: string, fromYear: number, toYear: number, limit: number): Promise<WaybackHit[]> {
  const exact = await waybackHits(url, fromYear, toYear, limit, 'exact');
  if (exact.length) return exact;
  return waybackHits(hostOf(url), fromYear, toYear, limit, 'domain');
}

/** Confirms a candidate screenshot url actually resolves to an image before we ever
 *  hand it to the browser — the fix for items rendering as a broken/404 <img>. mshots
 *  itself can fail outright (blocked host, malformed input, dead archived page), and
 *  this is the one place that catches it instead of trusting the URL blindly. */
async function verifyImage(url: string, timeoutMs = 6000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': UA } });
    const contentType = res.headers.get('content-type') ?? '';
    return res.ok && contentType.startsWith('image/');
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Render `pageUrl` with our own request-blocking Chromium (screenshotRender.ts) —
 *  the real fix, since only a renderer we control can stop a Wayback replay page
 *  hydrating from the live web. Falls back to a verified mshots screenshot of the
 *  same page (imperfect for JS-heavy sites, but still real for static ones, and a
 *  safety net if Chromium/Storage isn't working for some reason), then to null. */
async function bestScreenshot(pageUrl: string, isHistorical: boolean): Promise<string | null> {
  try {
    return await renderAndStore(pageUrl, isHistorical);
  } catch {
    const fallback = mshotsUrl(pageUrl);
    return (await verifyImage(fallback)) ? fallback : null;
  }
}

/** The single best screenshot for a curated item: the closest Wayback snapshot to
 *  `year` that actually renders, walking outward candidate-by-candidate; falls back
 *  to the live site; falls back to "" (needs image, same as a hardware item
 *  Wikimedia couldn't resolve) rather than ever returning a broken/wrong image. */
export async function screenshotForYear(rawUrl: string, year: number | null): Promise<string> {
  const url = normalizeUrl(rawUrl);
  if (!url) return '';
  const currentYear = new Date().getFullYear();

  if (year != null && year < currentYear - 1) {
    const hits = await findWaybackHits(url, year - 3, year + 3, 6);
    const sorted = [...hits].sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year));
    for (const h of sorted) {
      const shot = await bestScreenshot(waybackPageUrl(url, h.timestamp), true);
      if (shot) return shot;
    }
  }

  return (await bestScreenshot(url, false)) ?? '';
}

/** Candidate screenshots for the picker grid: a spread of nearby Wayback snapshots
 *  (plus the live site) around an optional target year, closest first — each
 *  rendered the same way a real curation call would, so what you pick is what
 *  you'll get. Only candidates that actually produced an image are returned. */
export async function screenshotCandidates(rawUrl: string, year: number | null, limit = 9): Promise<string[]> {
  const url = normalizeUrl(rawUrl);
  if (!url) return [];
  const currentYear = new Date().getFullYear();
  const target = year ?? currentYear;
  const hits = await findWaybackHits(url, target - 8, Math.min(target + 8, currentYear), limit * 2);

  // One snapshot per year, closest years to the target first.
  const byYear = new Map<number, WaybackHit>();
  for (const h of hits) if (!byYear.has(h.year)) byYear.set(h.year, h);
  const sorted = [...byYear.values()]
    .sort((a, b) => Math.abs(a.year - target) - Math.abs(b.year - target))
    .slice(0, limit);

  const historical = await Promise.all(
    sorted.map((h) => bestScreenshot(waybackPageUrl(url, h.timestamp), true)),
  );
  const live = await bestScreenshot(url, false); // always offer the live site too

  return [...historical, live].filter((u): u is string => !!u).slice(0, limit);
}
