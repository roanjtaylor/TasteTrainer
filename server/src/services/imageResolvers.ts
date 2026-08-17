// The resolver cascade for digital-world images (7-software-design.md, 4-images.md).
//
// The pipeline this replaces was: ask Claude for one url, screenshot it, store whatever
// came back. That is the right strategy for part of the digital world and structurally
// wrong for the rest — an icon set, a typeface, a 1984 desktop and a 1972 terminal form
// are all digital design, and none of them is a web page. Items like those were given
// their own Wikipedia ARTICLE url and the pipeline screenshotted the encyclopaedia.
//
// So sourcing is split two ways. `imageKind` (set by the model, see curation-rules.md
// §f) says which kind of thing this is; the registry below says which resolvers can
// actually produce a picture of that kind, in order. Every candidate any of them
// returns is scored by imageQuality.ts, because no source here is reliable enough to
// trust on its own: Wikipedia has the real VisiCalc screenshot but nothing for Windows
// 95, and a Commons search for "Mac OS System 7 desktop" returns 14x16 widget icons.
// Choosing between scored candidates is the part that buys accuracy — not the sources.
import type {
  Capture, CandidateSource, ImageCandidate, ImageKind,
} from '../../../shared/types.ts';
import { renderAndStore, type RenderOutcome } from './screenshotRender.ts';
import {
  commonsImages, duckDuckGoImages, findWaybackHits, mshotsUrl,
  normalizeUrl, waybackPageUrl, wikimediaImage,
} from './images.ts';
import {
  combine, copyrightYearIn, inspectImage, scoreFile, scoreRender,
  type SizeProfile, type Verdict,
} from './imageQuality.ts';

const UA = 'TasteTrainer/0.1 (personal design-study tool) Node fetch';

export interface ResolveHints {
  name: string;
  year: number | null;
  imageKind?: ImageKind;
  url?: string;
  wikipediaTitle?: string;
  imageQuery?: string;
}

export interface ResolveResult {
  image: string;
  capture?: Capture;
  /** Everything that survived scoring, best first — the review grid's swap strip. */
  candidates: ImageCandidate[];
}

/** A found image before scoring. */
interface RawCandidate {
  url: string;
  source: CandidateSource;
  /** The year this image represents, when the source knows it. */
  year?: number;
  profile: SizeProfile;
  /** Present when we rendered it ourselves, so the page's own signals can be scored. */
  render?: RenderOutcome;
}

/** Run `fn` over `items` with at most `limit` in flight.
 *
 *  The old attachImages() did an unbounded Promise.all over every proposed item; with
 *  several resolvers per item that multiplies into hundreds of simultaneous requests to
 *  Wikimedia and archive.org, both of which throttle. Order of results is preserved. */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---- Individual resolvers -------------------------------------------------
//
// Each returns candidate urls only. None of them decides anything: scoring does.

/** Our own request-blocking Chromium over Wayback snapshots near `year`, closest first.
 *  The only renderer that can stop an archived page re-hydrating from the live web. */
async function waybackRenders(
  rawUrl: string,
  year: number,
  maxAttempts: number,
  onNote?: (line: string) => void,
): Promise<RawCandidate[]> {
  const url = normalizeUrl(rawUrl);
  if (!url) return [];
  const hits = await findWaybackHits(url, year - 3, year + 3, 6);
  if (!hits.length) return [];

  const sorted = [...hits].sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year));
  const out: RawCandidate[] = [];
  // Sequential and capped: each attempt is a full browser render, and the closest
  // snapshot usually works, so rendering all six would waste most of the work.
  for (const hit of sorted.slice(0, maxAttempts)) {
    try {
      const render = await renderAndStore(waybackPageUrl(url, hit.timestamp), true);
      out.push({ url: render.url, source: 'wayback-render', year: hit.year, profile: 'rendered', render });
      // One good archived capture is the answer; stop paying for more.
      if (!render.reused && render.textLength > 200) break;
    } catch (err: any) {
      onNote?.(`render failed (${hit.year}): ${err?.message ?? err}`);
    }
  }
  return out;
}

/** Our own Chromium over the live site — no blocking, since there is nothing to fake. */
async function liveRender(rawUrl: string, onNote?: (line: string) => void): Promise<RawCandidate[]> {
  const url = normalizeUrl(rawUrl);
  if (!url) return [];
  try {
    const render = await renderAndStore(url, false);
    return [{ url: render.url, source: 'live-render', year: new Date().getFullYear(), profile: 'rendered', render }];
  } catch (err: any) {
    onNote?.(`live render failed: ${err?.message ?? err}`);
    return [];
  }
}

/** Free third-party screenshotter. Kept because it works when our renderer cannot, but
 *  demoted in scoring: it renders a Wayback replay page with no request blocking, which
 *  is the exact failure the self-hosted renderer exists to prevent, and it answers a
 *  cold request with a "generating…" placeholder that scoring rejects by hash. */
function mshotsCandidate(pageUrl: string, year?: number): RawCandidate[] {
  const url = normalizeUrl(pageUrl);
  return url ? [{ url: mshotsUrl(url), source: 'mshots', year, profile: 'rendered' }] : [];
}

/** Paid screenshot API (urlbox / screenshotone) — a scored source, not an emergency
 *  catch, so a weak self-hosted render can lose to a good paid one on merit.
 *  Unconfigured is the normal case and returns nothing rather than failing. */
function paidScreenshot(pageUrl: string, year?: number): RawCandidate[] {
  const key = process.env.SCREENSHOT_API_KEY;
  const base = process.env.SCREENSHOT_API_URL;
  const url = normalizeUrl(pageUrl);
  if (!key || !base || !url) return [];
  // Both providers take the target as a query param and stream the image back, so the
  // result is still just a url — 2-data.md #3's rule survives.
  const built = `${base}${base.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}&access_key=${encodeURIComponent(key)}`;
  return [{ url: built, source: 'paid-screenshot', year, profile: 'rendered' }];
}

/** The article's lead image. Free, stable, and for pre-web software often the single
 *  best picture in existence — Wikipedia's VisiCalc lead IS the 1979 screenshot. */
async function wikipediaLead(title: string): Promise<RawCandidate[]> {
  const url = await wikimediaImage(title);
  return url ? [{ url, source: 'wikipedia', profile: 'reference' }] : [];
}

/** Wikimedia Commons file search. Excellent for freely-licensed software screenshots
 *  (Netscape Navigator 2 at 960x601) and noisy elsewhere, which scoring sorts out. */
async function commonsCandidates(query: string, limit: number): Promise<RawCandidate[]> {
  const urls = await commonsImages(query, limit);
  return urls.map((url) => ({ url, source: 'commons' as const, profile: 'reference' as const }));
}

/** DuckDuckGo image search — broadest reach, lowest trust, so it is last everywhere. */
async function ddgCandidates(query: string, limit: number): Promise<RawCandidate[]> {
  const urls = await duckDuckGoImages(query, limit);
  return urls.map((url) => ({ url, source: 'ddg' as const, profile: 'reference' as const }));
}

/**
 * Internet Archive's software library — 23k+ MS-DOS titles alone, many carrying a real
 * screenshot file and a release year. The best source for software that was never a
 * website and is too obscure for Wikipedia.
 *
 * Files in item subdirectories 500 through the /download/ proxy, so urls are built from
 * the metadata API's own server + dir fields instead.
 */
async function iaSoftwareCandidates(query: string, limit = 3): Promise<RawCandidate[]> {
  const search =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`title:(${query}) AND mediatype:software`)}` +
    `&fl[]=identifier&fl[]=year&rows=${limit}&output=json`;
  let ids: Array<{ identifier: string; year?: number }> = [];
  try {
    const res = await fetch(search, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    if (!res.ok) return [];
    const data: any = await res.json();
    ids = (data?.response?.docs ?? []).filter((d: any) => d?.identifier);
  } catch { return []; }

  const out: RawCandidate[] = [];
  for (const doc of ids) {
    try {
      const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, {
        headers: { 'User-Agent': UA, accept: 'application/json' },
      });
      if (!res.ok) continue;
      const meta: any = await res.json();
      const host = meta?.d1 ?? meta?.server;
      const dir = meta?.dir;
      if (!host || !dir) continue;
      const shots = (meta.files ?? []).filter(
        (f: any) =>
          /screenshot/i.test(f?.name ?? '') &&
          /\.(png|jpe?g|gif)$/i.test(f?.name ?? '') &&
          !/_thumb\./i.test(f?.name ?? ''),
      );
      const year = Number(doc.year ?? meta?.metadata?.year);
      for (const f of shots.slice(0, 2)) {
        out.push({
          url: `https://${host}${dir}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
          source: 'ia-software',
          year: Number.isFinite(year) ? year : undefined,
          profile: 'reference',
        });
      }
    } catch { /* skip this item */ }
  }
  return out;
}

// ---- Scoring + cascade ----------------------------------------------------

/** Judge one raw candidate, folding in the page signals when we rendered it ourselves. */
async function scoreCandidate(raw: RawCandidate, hints: ResolveHints): Promise<ImageCandidate | null> {
  const verdicts: Verdict[] = [];

  if (raw.render && !raw.render.reused) {
    verdicts.push(scoreRender(raw.render, raw.render.bytes));

    // The page's own footer date is evidence about the CONTENT, which is the one thing
    // a url and an HTTP status can never tell us. A 2015 snapshot that renders "© 2026"
    // hydrated into the present — the silent failure the whole renderer exists to stop.
    const stated = copyrightYearIn(raw.render.textSample);
    if (stated != null && hints.year != null && stated - hints.year > 3) {
      verdicts.push({
        fatal: false,
        confidence: 'low',
        reasons: [`page says © ${stated} but the item is ${hints.year}`],
      });
    }
  }

  const facts = await inspectImage(raw.url);
  verdicts.push(scoreFile(facts, raw.profile));

  // mshots renders archived pages with no request blocking, so even a valid image from
  // it may be today's design wearing a past date. Real, but never fully trusted.
  if (raw.source === 'mshots') {
    verdicts.push({ fatal: false, confidence: 'medium', reasons: ['third-party screenshot, unverified'] });
  }

  // An image search is an unattributed web scrape: nothing ties the result to the work
  // beyond a filename and someone's blog. Capped for the same reason mshots is, and it
  // matters more than it looks — a big modern screenshot of a retro subject outscores a
  // small authentic one on pixels alone, so without this the 2025 blog post about
  // VisiCalc beat Wikipedia's actual 1979 VisiCalc screenshot.
  if (raw.source === 'ddg') {
    verdicts.push({ fatal: false, confidence: 'medium', reasons: ['web search result, unverified'] });
  }

  const v = combine(...verdicts);
  if (v.fatal) return null;
  return {
    url: raw.url,
    source: raw.source,
    confidence: v.confidence,
    year: raw.year,
    width: facts.width ?? undefined,
    height: facts.height ?? undefined,
    note: v.reasons.join('; ') || undefined,
  };
}

const RANK: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 1, low: 2 };

/** How much a source's word is worth, independent of how big its picture is.
 *
 *  Resolution is a bad proxy for correctness on historical subjects, because the
 *  authentic artefact is usually the SMALL one — a 1984 Macintosh screen was 512x342,
 *  and Wikipedia's genuine VisiCalc screenshot is 560x384. Ranking on pixels alone
 *  hands every pre-web item to whichever modern blog wrote about it most recently.
 *  A curated, attributable archive outranks a scrape at equal confidence. */
const SOURCE_TRUST: Record<CandidateSource, number> = {
  manual: 0,           // a human chose it
  'wayback-render': 1, // our own renderer, request-blocked, from the archive
  'live-render': 1,
  wikipedia: 2,
  commons: 2,
  'ia-software': 3,
  'paid-screenshot': 3,
  mshots: 4,
  ddg: 5,
};

/** Best first: confidence, then source trust, then closeness to the item's year,
 *  then pixel width as the final tiebreak within an otherwise equal tier. */
function bestFirst(candidates: ImageCandidate[], year: number | null): ImageCandidate[] {
  return [...candidates].sort((a, b) => {
    const byConfidence = RANK[a.confidence] - RANK[b.confidence];
    if (byConfidence) return byConfidence;
    const byTrust = SOURCE_TRUST[a.source] - SOURCE_TRUST[b.source];
    if (byTrust) return byTrust;
    if (year != null && a.year != null && b.year != null) {
      const byYear = Math.abs(a.year - year) - Math.abs(b.year - year);
      if (byYear) return byYear;
    }
    return (b.width ?? 0) - (a.width ?? 0);
  });
}

function captureFor(chosen: ImageCandidate, hints: ResolveHints): Capture {
  const kind: Capture['kind'] =
    chosen.source === 'wayback-render' || chosen.source === 'mshots' || chosen.source === 'paid-screenshot'
      ? (chosen.year != null && hints.year != null && chosen.year < new Date().getFullYear() ? 'archived' : 'live')
      : chosen.source === 'live-render'
        ? 'live'
        : 'reference';
  return {
    kind,
    year: chosen.year,
    source: chosen.source,
    confidence: chosen.confidence,
    note: chosen.note,
  };
}

/** Which kind of thing is this, when the model didn't say?
 *  Older datasets and re-resolve runs have no `imageKind`, so infer the previous
 *  behaviour: a real site url means the site path, anything else means a reference. */
export function inferImageKind(hints: ResolveHints): ImageKind {
  if (hints.imageKind) return hints.imageKind;
  const url = (hints.url ?? '').trim();
  if (!url || /wikipedia\.org/i.test(url)) return 'software-ui';
  const currentYear = new Date().getFullYear();
  return hints.year != null && hints.year < currentYear - 1 ? 'archived-site' : 'live-site';
}

/**
 * Resolve the best available image for one digital item.
 *
 * Site kinds try renderers first and stop as soon as one scores high, because each
 * attempt is a browser render; reference kinds fan out across the cheap archive/search
 * sources at once and let scoring choose. Either way, if nothing scores high the
 * remaining candidates are returned too, so the review grid can offer a swap instead of
 * silently keeping a poor pick — which is how the 10 placeholder GIFs got saved.
 */
export async function resolveDigitalImage(
  hints: ResolveHints,
  onNote?: (line: string) => void,
): Promise<ResolveResult> {
  const kind = inferImageKind(hints);
  const query = hints.imageQuery?.trim() || hints.wikipediaTitle?.trim() || hints.name;
  const raw: RawCandidate[] = [];

  if (kind === 'archived-site' || kind === 'live-site') {
    const year = hints.year;
    const wantsArchive = kind === 'archived-site' && year != null && year < new Date().getFullYear() - 1;

    if (wantsArchive) raw.push(...(await waybackRenders(hints.url ?? '', year!, 3, onNote)));
    if (!raw.length) raw.push(...(await liveRender(hints.url ?? '', onNote)));

    // Only pay for the fallbacks if our own renderer produced nothing usable.
    if (!raw.length) {
      raw.push(...paidScreenshot(hints.url ?? '', hints.year ?? undefined));
      raw.push(...mshotsCandidate(hints.url ?? '', hints.year ?? undefined));
    }
  } else {
    // Nothing here renders, so everything can run at once.
    const [wiki, commons, ia, ddg] = await Promise.all([
      hints.wikipediaTitle ? wikipediaLead(hints.wikipediaTitle) : Promise.resolve([]),
      commonsCandidates(query, 5),
      iaSoftwareCandidates(query, 2),
      ddgCandidates(query, 5),
    ]);
    raw.push(...wiki, ...commons, ...ia, ...ddg);
  }

  const score = async (list: RawCandidate[]) =>
    (await mapWithLimit(list, 4, (c) => scoreCandidate(c, hints)))
      .filter((c): c is ImageCandidate => c !== null);

  let scored = await score(raw);

  // A site item whose capture didn't SURVIVE still deserves a picture — fall through to
  // the reference sources rather than keeping a bad one. The test is what survived, not
  // what was found: a 1984 Macintosh item pointed at an in-browser emulator, the live
  // render "succeeded" and produced a black screen, and because a candidate existed the
  // fallback never ran. Something returning bytes is not the same as something working.
  if (!scored.length && (kind === 'archived-site' || kind === 'live-site')) {
    const [wiki, commons, ddg] = await Promise.all([
      hints.wikipediaTitle ? wikipediaLead(hints.wikipediaTitle) : Promise.resolve([]),
      commonsCandidates(query, 4),
      ddgCandidates(query, 4),
    ]);
    scored = await score([...wiki, ...commons, ...ddg]);
  }

  let ranked = bestFirst(scored, hints.year);

  // Uncertainty about the STRATEGY has to survive into the result. Without `imageKind`
  // the kind was guessed from whether a url exists, and that guess is wrong in a
  // specific, confident-looking way: an item like "macOS Sequoia" carries apple.com, so
  // it resolves to a flawless render of Apple's marketing page rather than the desktop
  // it is supposed to show. A high score on a well-rendered picture of the wrong thing
  // is exactly the failure this pipeline exists to stop, so capping here also makes the
  // review grid offer the alternatives instead of hiding them.
  if (!hints.imageKind && ranked.length) {
    ranked = ranked.map((c) =>
      c.confidence === 'high'
        ? { ...c, confidence: 'medium', note: [c.note, 'item kind was guessed'].filter(Boolean).join('; ') }
        : c,
    );
  }

  if (!ranked.length) return { image: '', candidates: [] };
  const chosen = ranked[0];
  return { image: chosen.url, capture: captureFor(chosen, hints), candidates: ranked };
}

/**
 * Resolve the best available image for one PHYSICAL item — a plain reference photo,
 * never a render, so this is the reference-source half of `resolveDigitalImage` above
 * (Wikipedia lead, Commons, DuckDuckGo) reused as-is, minus the render/screenshot and
 * software-archive sources that only make sense for the digital world.
 *
 * This replaces what used to be a single blind `searchImages(query, 1)` call with no
 * scoring at all — the same gap that made the manual "swap image" flow (which shows the
 * human several candidates to choose from) far more reliable than first-pass generation.
 * Scoring here is the same `scoreCandidate`/`bestFirst` used for digital reference
 * sources, which already only exercises its render-specific signals when a candidate
 * carries `.render` — a physical `RawCandidate` never does, so nothing digital-specific
 * leaks into this path.
 */
export async function resolvePhysicalImage(hints: ResolveHints): Promise<ResolveResult> {
  const query = hints.imageQuery?.trim() || hints.wikipediaTitle?.trim() || hints.name;
  const [wiki, commons, ddg] = await Promise.all([
    hints.wikipediaTitle ? wikipediaLead(hints.wikipediaTitle) : Promise.resolve([]),
    commonsCandidates(query, 5),
    ddgCandidates(query, 5),
  ]);

  const scored = (
    await mapWithLimit([...wiki, ...commons, ...ddg], 4, (c) => scoreCandidate(c, hints))
  ).filter((c): c is ImageCandidate => c !== null);

  const ranked = bestFirst(scored, hints.year);
  if (!ranked.length) return { image: '', candidates: [] };
  const chosen = ranked[0];
  return { image: chosen.url, capture: captureFor(chosen, hints), candidates: ranked };
}
