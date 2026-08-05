// Scoring for candidate images (4-images.md, 7-software-design.md).
//
// Why this module exists: every image source available for the digital world is
// high-variance. Wikipedia's lead image is the real VisiCalc screenshot but nothing at
// all for Windows 95; a Commons search for "Mac OS System 7 desktop" returns 14x16
// widget icons; mshots answers a failed capture with a "generating..." placeholder GIF
// and a 200. The old check — `content-type` starts with "image/" — passes ALL of those.
// Ten of the ninety-nine digital items in production are that placeholder GIF, stored
// permanently, because it is a perfectly valid `image/gif`.
//
// So the pipeline cannot pick a source and trust it. It has to gather candidates and
// judge them, and this is the judging. Nothing here needs an image library: dimensions
// come from the file header's first few bytes, and the strongest signals come from the
// page we rendered rather than the pixels we rendered it into.
import crypto from 'node:crypto';
import type { PageSignals } from './screenshotRender.ts';

const UA = 'TasteTrainer/0.1 (personal design-study tool) Node fetch';

export type Confidence = 'high' | 'medium' | 'low';

/** How forgiving the size checks should be.
 *
 *  `rendered` is our own 1280x900 capture, so anything much smaller means something
 *  went wrong. `reference` is a found historical image, where small IS period-accurate:
 *  a 1984 Macintosh screen was 512x342 and Wikipedia's genuine VisiCalc screenshot is
 *  560x384. Judging those by a modern screenshot's standards would throw away the exact
 *  images this whole pipeline exists to find. */
export type SizeProfile = 'rendered' | 'reference';

const MIN_WIDTH: Record<SizeProfile, number> = { rendered: 800, reference: 280 };
/** Usable, but too small to actually study a design in — demoted a full tier so a
 *  well-provenanced thumbnail can't outrank a large picture from a lesser source.
 *  This is the line between "authentically small" (a 512x342 Macintosh screen) and
 *  "just a thumbnail" (a 330px Wikipedia crop of an emulator window). */
const POOR_WIDTH: Record<SizeProfile, number> = { rendered: 900, reference: 450 };
const IDEAL_WIDTH: Record<SizeProfile, number> = { rendered: 1000, reference: 640 };

/** Known junk, pinned by content hash.
 *
 *  The mshots "generating..." placeholder: 8737 bytes, GIF89a, 400x300 even when the
 *  request asked for 1200x900. Hash-pinned rather than size-sniffed so a real 8 KB
 *  image is never mistaken for it. The size/dimension heuristic below still catches
 *  the same file if WordPress ever re-encodes it. */
const PLACEHOLDER_SHA256 = new Set([
  '499aca54997274ea22603657e5ad3d6408387fb2463158083b15e8cc94f08201',
]);

/** Worth retrying rather than believing. Wikimedia and archive.org both throttle. */
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface ImageFacts {
  url: string;
  reachable: boolean;
  contentType: string;
  bytes: number;
  /** Total size when the server reported one; falls back to bytes actually read. */
  declaredBytes: number | null;
  width: number | null;
  height: number | null;
  /** Only meaningful when the whole file was read (`complete`). */
  sha256: string | null;
  complete: boolean;
  error?: string;
}

/** Read enough of `url` to know what it actually is.
 *
 *  Ranged so a large screenshot isn't downloaded in full just to be measured — the
 *  header carries the dimensions. Servers that ignore Range send the whole body, which
 *  is fine. When the body arrives complete (small files — placeholders are 8.7 KB) the
 *  hash is exact, which is what lets a known placeholder be rejected by identity rather
 *  than by guesswork. Replaces the old verifyImage(), which issued a full GET and then
 *  looked at nothing but the content-type. */
export async function inspectImage(
  url: string,
  timeoutMs = 12_000,
  attempt = 0,
): Promise<ImageFacts> {
  const base: ImageFacts = {
    url, reachable: false, contentType: '', bytes: 0, declaredBytes: null,
    width: null, height: null, sha256: null, complete: false,
  };
  if (!url) return { ...base, error: 'empty url' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, Range: 'bytes=0-262143' },
    });
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();

    // Back off and retry rather than reject. Wikimedia throttles above roughly one
    // request a second and answers 429 — during testing that discarded a perfectly
    // good Netscape Navigator screenshot as if the file were bad. A transient
    // throttle must not look like a permanent verdict about the image.
    if (TRANSIENT_STATUS.has(res.status) && attempt < 2) {
      clearTimeout(timer);
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 5_000)
        : 600 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      return inspectImage(url, timeoutMs, attempt + 1);
    }
    if (!res.ok) return { ...base, contentType, error: `HTTP ${res.status}` };

    const buf = Buffer.from(await res.arrayBuffer());
    // content-range wins: with a 206 the content-length is only the slice we asked for.
    const range = res.headers.get('content-range');
    const totalFromRange = range ? Number(range.split('/')[1]) : NaN;
    const declaredBytes = Number.isFinite(totalFromRange)
      ? totalFromRange
      : Number(res.headers.get('content-length')) || null;
    const complete = declaredBytes == null ? res.status === 200 : buf.length >= declaredBytes;
    const { width, height } = readDimensions(buf);

    return {
      url,
      reachable: true,
      contentType,
      bytes: buf.length,
      declaredBytes,
      width,
      height,
      sha256: complete ? crypto.createHash('sha256').update(buf).digest('hex') : null,
      complete,
    };
  } catch (err: any) {
    return { ...base, error: err?.name === 'AbortError' ? 'timed out' : String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Pixel dimensions from a file header, for the four formats these sources return.
 *  Deliberately no image library — this is a few dozen bytes of parsing and keeps a
 *  native dependency (and its Docker build cost) out of the server. */
export function readDimensions(b: Buffer): { width: number | null; height: number | null } {
  const none = { width: null, height: null };
  if (b.length < 16) return none;

  // PNG: 8-byte magic, then IHDR with width/height as big-endian uint32.
  if (b.readUInt32BE(0) === 0x89504e47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }

  // GIF: "GIF87a"/"GIF89a", then little-endian uint16 logical screen size.
  const magic6 = b.subarray(0, 6).toString('latin1');
  if (magic6 === 'GIF87a' || magic6 === 'GIF89a') {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }

  // JPEG: walk the segment chain to a Start-Of-Frame, which carries the real size.
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i += 1; continue; }
      const marker = b[i + 1];
      // SOF0-SOF15, excluding DHT(c4), JPGA(c8) and DAC(cc) which aren't frame headers.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
    return none;
  }

  // WebP: RIFF container, size in the VP8X/VP8 /VP8L chunk depending on the variant.
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = b.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X' && b.length >= 30) {
      return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (chunk === 'VP8 ' && b.length >= 30) {
      return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }

  return none;
}

export interface Verdict {
  confidence: Confidence;
  /** Human-readable, shown in the curate stream and stored on the item. */
  reasons: string[];
  fatal: boolean;
}

function verdict(fatal: boolean, confidence: Confidence, reasons: string[]): Verdict {
  return { fatal, confidence, reasons };
}

/** Is this file usable as an item image at all, and how good is it? */
export function scoreFile(facts: ImageFacts, profile: SizeProfile): Verdict {
  if (!facts.reachable) return verdict(true, 'low', [facts.error ?? 'unreachable']);
  if (!facts.contentType.startsWith('image/')) {
    return verdict(true, 'low', [`not an image (${facts.contentType || 'no content-type'})`]);
  }
  if (facts.sha256 && PLACEHOLDER_SHA256.has(facts.sha256)) {
    return verdict(true, 'low', ['screenshot service returned its "generating…" placeholder']);
  }

  const reasons: string[] = [];
  const w = facts.width ?? 0;
  const h = facts.height ?? 0;
  const totalBytes = facts.declaredBytes ?? facts.bytes;

  // Near-empty check against the STORED file, not just a fresh render's buffer.
  // Screenshots are content-addressed, so a reused capture comes back with no page
  // signals and no byte count at all — which is precisely how a black screen survived
  // one round of repair: it had already been stored, so the render-time checks never
  // ran again. Measuring the artifact catches it however it arrived.
  if (profile === 'rendered' && totalBytes > 0 && totalBytes < 15_000) {
    return verdict(true, 'low', [`rendered almost nothing (${Math.round(totalBytes / 1024)} KB of image)`]);
  }

  // Unmeasurable is not fatal — SVG and a few exotic encodings have no header size —
  // but it can't be trusted at full confidence either.
  if (!facts.width || !facts.height) {
    return verdict(false, 'medium', ['could not read image dimensions']);
  }
  if (w < MIN_WIDTH[profile]) {
    return verdict(true, 'low', [`too small at ${w}x${h} (want ≥${MIN_WIDTH[profile]}px wide)`]);
  }
  if (w < POOR_WIDTH[profile]) return verdict(false, 'low', [`only ${w}x${h} — hard to study`]);
  if (w < IDEAL_WIDTH[profile]) reasons.push(`small at ${w}x${h}`);

  // An icon-shaped result from an image search is almost never the thing being studied.
  const ratio = w / h;
  if (ratio > 4 || ratio < 0.25) reasons.push(`unusual aspect ratio ${ratio.toFixed(2)}`);

  return verdict(false, reasons.length ? 'medium' : 'high', reasons);
}

// archive.org serves its failure states as ordinary HTML with a 200, so a screenshot of
// one is a valid PNG of the wrong thing — invisible to any check on the response.
// Matched on the rendered page's own text instead.
const ARCHIVE_ERROR_MARKERS = [
  'this page is not available',
  'wayback machine has not archived',
  'page cannot be displayed',
  'got an error',
  'hrm.',
  'the wayback machine is an initiative',
  'this url has been excluded',
  'redirecting to',
];

/** Judge a page we rendered ourselves, from what the DOM said while it was open.
 *
 *  The two failures this catches are both invisible in the resulting image bytes:
 *  archive.org's error pages (a real screenshot of a real page that isn't the site),
 *  and a render starved by the request-blocking into near-blankness — the outcome
 *  7-software-design.md called an honest failure and then never detected.
 *
 *  Thresholds are deliberately loose. The verified-good Google 2001 capture is 305
 *  characters of text, one image, and mostly white space; a genuinely sparse page from
 *  the era we most want must not be mistaken for a broken one. */
export function scoreRender(signals: PageSignals, bytes: number): Verdict {
  const haystack = `${signals.pageTitle} `.toLowerCase();
  const hit = ARCHIVE_ERROR_MARKERS.find((m) => haystack.includes(m));
  if (hit) return verdict(true, 'low', [`archive error page ("${signals.pageTitle.slice(0, 60)}")`]);

  // A PNG's compressed size IS a measure of how much is actually on screen, and at a
  // fixed 1280x900 viewport it is the most reliable signal available — more so than the
  // DOM, which describes the page rather than the picture.
  //
  // The case that taught this: a 1984 Macintosh item resolved to an in-browser emulator
  // page and was captured before the emulator booted, so the screenshot is a black
  // rectangle in a beige bezel. Every DOM check passed — real title, nav text, an Apple
  // logo among the images — and the picture was still empty. It weighed 8.7 KB. For
  // comparison the sparsest legitimate render found, Google's 2001 homepage, is 40 KB.
  if (bytes > 0 && bytes < 15_000) {
    return verdict(true, 'low', [`rendered almost nothing (${Math.round(bytes / 1024)} KB of image)`]);
  }

  // Blank means all three agree: no text, no images, and a PNG that compressed to
  // almost nothing. Any one alone has legitimate explanations.
  if (signals.textLength < 40 && signals.imageCount === 0 && bytes < 20_000) {
    return verdict(true, 'low', ['rendered blank — nothing survived the archive replay']);
  }

  const reasons: string[] = [];
  if (signals.textLength < 40 && signals.imageCount <= 1) reasons.push('page rendered almost empty');
  if (!signals.pageTitle.trim()) reasons.push('page had no title');
  return verdict(false, reasons.length ? 'medium' : 'high', reasons);
}

/** Does the page say what year it is?
 *
 *  A period screenshot usually dates itself — the verified Google 2001 capture renders
 *  "©2001 Google" in its footer. That is direct evidence about the CONTENT, where
 *  Item.capture only records which snapshot url we asked for, and it is the one cheap
 *  check that can catch a Wayback replay that quietly re-hydrated into the present. */
export function copyrightYearIn(pageText: string): number | null {
  const m = pageText.match(/(?:©|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i);
  const year = m ? Number(m[1]) : NaN;
  return Number.isFinite(year) && year >= 1970 && year <= new Date().getFullYear() + 1 ? year : null;
}

/** Combine every verdict gathered for one candidate. Fatal anywhere is fatal overall;
 *  otherwise the weakest confidence wins and the reasons accumulate. */
export function combine(...verdicts: Verdict[]): Verdict {
  const reasons = verdicts.flatMap((v) => v.reasons);
  if (verdicts.some((v) => v.fatal)) {
    return verdict(true, 'low', reasons.length ? reasons : ['rejected']);
  }
  const rank: Confidence[] = ['low', 'medium', 'high'];
  const worst = verdicts.reduce<Confidence>(
    (acc, v) => (rank.indexOf(v.confidence) < rank.indexOf(acc) ? v.confidence : acc),
    'high',
  );
  return verdict(false, worst, reasons);
}

/**
 * Ask Claude whether the image actually depicts the item — the only check that can
 * catch a well-formed screenshot of the wrong thing.
 *
 * Unwired on purpose. The HF Space proxy (services/claude.ts) sends `content` as a
 * plain string and rejects Anthropic content blocks with
 * "last.content.trim is not a function", so it cannot carry an image today. This is the
 * seam: when the Space accepts blocks, this returns a real Verdict and joins combine()
 * with no other change anywhere. Until then it abstains rather than guessing, so it
 * never affects a score.
 */
export async function scoreWithVision(_imageUrl: string, _itemName: string, _year: number | null): Promise<Verdict> {
  return verdict(false, 'high', []);
}
