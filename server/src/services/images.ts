// Image sourcing (4-images.md): Wikimedia/Wikipedia as the default lead image,
// plus an unofficial DuckDuckGo image search that powers the 3x3 swap picker.
// URLs only — nothing is downloaded (2-data.md).

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
 * Unofficial endpoint: fetch a vqd token, then hit i.js. Acceptable for a personal
 * tool; if it breaks it's a small, contained fix (4-images.md).
 */
export async function searchImages(queryText: string, limit = 9): Promise<string[]> {
  if (!queryText.trim()) return [];
  const q = encodeURIComponent(queryText.trim());
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
