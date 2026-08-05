// Self-hosted screenshot renderer for the digital world (7-software-design.md).
//
// Why this exists: a URL-in/image-out service like mshots can't stop a Wayback
// Machine replay page's own client-side JS from reaching the LIVE internet for
// data/assets Wayback didn't capture -- a JS-heavy modern SPA can "hydrate" into
// looking like TODAY's design during replay even though the screenshot request
// technically succeeds. The fix needs a renderer we control, so we can block every
// request that isn't served from archive.org while capturing. This module is that
// renderer: a reused headless Chromium instance (Playwright), a small internal
// concurrency limit (a batch curation call can ask for a dozen+ screenshots at
// once -- this caps how many actually render in parallel regardless of how many
// callers ask), and a Supabase Storage upload so `item.image` is still just a URL
// (2-data.md #3's link-don't-store rule), even though the bytes are now ours.
import crypto from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config.ts';

// Bucket name predates the physical/digital rename and is deliberately NOT renamed:
// every already-stored screenshot's public URL contains it, and those URLs are saved
// inside dataset rows. Renaming would break every existing image to gain nothing.
const BUCKET = 'software-screenshots';

// Object keys are a hash of the exact page url (storageKeyFor), so a given key's bytes
// never change — the content IS the identity. That makes these safely cacheable
// forever, and leaving them on Supabase Storage's one-hour default meant every browser
// re-downloaded every screenshot roughly hourly, which is pure egress for no benefit.
// A year means each viewer fetches a given screenshot exactly once.
//
// Bare seconds, not a full directive: supabase-js sends this as `max-age=${value}`,
// so anything more elaborate here would produce a malformed header.
const IMAGE_CACHE_SECONDS = '31536000';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

let bucketReady: Promise<void> | null = null;
/** Idempotent, self-provisioning -- no manual Supabase dashboard step required. */
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = supabase.storage.createBucket(BUCKET, { public: true }).then(({ error }) => {
      if (error && !/already exists|duplicate/i.test(error.message)) {
        // Don't cache a real failure -- worth retrying on the next call.
        bucketReady = null;
        throw new Error(`Could not create Supabase Storage bucket "${BUCKET}": ${error.message}`);
      }
    });
  }
  return bucketReady;
}

let browserPromise: Promise<Browser> | null = null;
async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.isConnected()) return existing;
    browserPromise = null;
  }
  // Both flags are Docker survival, not tuning. A Render container runs as root, and
  // Chromium refuses to start as root without --no-sandbox. /dev/shm defaults to 64 MB
  // in Docker, which Chromium exhausts on any real page and dies mid-navigation with a
  // bare "Target closed" — --disable-dev-shm-usage moves that scratch space to /tmp.
  // Neither is needed on a dev machine, which is exactly why their absence produced a
  // renderer that worked locally and had never once succeeded in production.
  browserPromise = chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return browserPromise;
}

// One at a time. A headless Chromium rendering a real page peaks well past 300 MB, and
// two of them alongside Node on a small Render instance is enough to get the container
// OOM-killed — a failure that surfaces as the same opaque render error as everything
// else. Throughput here is bounded by Wayback's response time anyway, not by us.
const MAX_CONCURRENT_RENDERS = 1;
let active = 0;
const queue: Array<() => void> = [];
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_RENDERS) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    queue.shift()?.();
  }
}

function isArchiveHost(hostname: string): boolean {
  return hostname === 'archive.org' || hostname.endsWith('.archive.org');
}

/** What the page looked like from the inside, captured in the same visit as the PNG.
 *
 *  Read while the page is still open because it is free here and impossible later: once
 *  a screenshot is bytes, telling "the archived page rendered" from "archive.org served
 *  an error page" or "the request-blocking starved it into a blank" needs pixel analysis.
 *  From inside the page it is three cheap DOM reads. imageQuality.ts scores these. */
export interface PageSignals {
  pageTitle: string;
  textLength: number;
  imageCount: number;
  /** First ~2 KB of visible text. Carries the strongest period evidence there is: a
   *  page of the era usually dates itself in its own footer ("©2001 Google"), which is
   *  about the CONTENT, where Capture only records which snapshot url we asked for. */
  textSample: string;
}

export interface RenderOutcome extends PageSignals {
  /** Public Supabase Storage url of the stored PNG. */
  url: string;
  bytes: number;
  /** True when an identical capture already existed and no browser work was needed. */
  reused: boolean;
}

/**
 * Screenshot `pageUrl` with a browser we fully control. `blockLiveRequests` should
 * be true for Wayback Machine snapshot urls: it aborts any request whose host isn't
 * archive.org, forcing the page to render only from what was actually archived
 * instead of quietly re-hydrating from the live web. Throws on failure — the
 * caller decides the fallback.
 */
async function renderScreenshot(
  pageUrl: string,
  blockLiveRequests: boolean,
): Promise<{ png: Buffer } & PageSignals> {
  return withRenderSlot(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      if (blockLiveRequests) {
        await context.route('**/*', (route) => {
          let hostname: string;
          try {
            hostname = new URL(route.request().url()).hostname;
          } catch {
            route.abort();
            return;
          }
          if (isArchiveHost(hostname)) route.continue();
          else route.abort();
        });
      }
      const page = await context.newPage();
      await page.goto(pageUrl, { waitUntil: 'load', timeout: 20_000 });
      // A short settle for late layout/paint (fonts, lazy images) — cheap once
      // live requests are blocked, since there's nothing left to wait on.
      await page.waitForTimeout(800);
      // Passed as a string, not a closure, on purpose: this expression runs in the
      // BROWSER, and typing a closure would mean adding "DOM" to the server's tsconfig
      // lib — letting every other server file reference browser globals it can never
      // have. A string keeps that boundary honest for the one place that crosses it.
      const signals = await page.evaluate<PageSignals>(
        `(function () {
          var text = (document.body ? document.body.innerText : '').trim();
          return {
            pageTitle: document.title || '',
            textLength: text.length,
            imageCount: document.images.length,
            textSample: text.slice(0, 2000),
          };
        })()`,
      );
      const png = (await page.screenshot({ type: 'png' })) as Buffer;
      return { png, ...signals };
    } finally {
      await context.close();
    }
  });
}

function storageKeyFor(pageUrl: string): string {
  return crypto.createHash('sha256').update(pageUrl).digest('hex');
}

async function existingPublicUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Render (or reuse an already-rendered) screenshot of `pageUrl`, returning a stable
 * public Supabase Storage url. Keyed by a hash of the exact page url — the same
 * historical snapshot referenced from two different datasets/items renders once and
 * is reused forever, which curation-rules.md §f's "reuse the same iconic product
 * across eras" guidance makes a common case, not an edge case.
 */
export async function renderAndStore(
  pageUrl: string,
  blockLiveRequests: boolean,
): Promise<RenderOutcome> {
  await ensureBucket();
  const path = `${storageKeyFor(pageUrl)}.png`;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // A cache hit carries no page signals — it was scored when it was first stored, and
  // re-rendering just to re-derive them would defeat the point of content-addressing.
  if (await existingPublicUrl(data.publicUrl)) {
    return {
      url: data.publicUrl, bytes: 0, reused: true,
      pageTitle: '', textLength: 0, imageCount: 0, textSample: '',
    };
  }

  const { png, ...signals } = await renderScreenshot(pageUrl, blockLiveRequests);
  const { error } = await supabase.storage.from(BUCKET).upload(path, png, {
    contentType: 'image/png',
    cacheControl: IMAGE_CACHE_SECONDS,
    upsert: true,
  });
  if (error) throw new Error(`Could not upload screenshot: ${error.message}`);
  return { url: data.publicUrl, bytes: png.length, reused: false, ...signals };
}

/** Render one page and report exactly what happened, storing nothing.
 *
 *  Exists because this renderer failed silently in production across four datasets: the
 *  bucket was created, every render threw, and `bestScreenshot` swallowed it into the
 *  mshots fallback, so 99 of 99 digital items got a third-party screenshot while the
 *  logs said nothing. Answering "is the renderer actually alive?" needed a database
 *  query and a storage listing. Now it is one request. */
export async function diagnoseRenderer(pageUrl: string, blockLiveRequests: boolean) {
  const started = Date.now();
  const steps: Record<string, unknown> = { pageUrl, blockLiveRequests };
  try {
    const browser = await getBrowser();
    steps.browserLaunched = true;
    steps.browserVersion = browser.version();
    const { png, ...signals } = await renderScreenshot(pageUrl, blockLiveRequests);
    Object.assign(steps, signals, { rendered: true, bytes: png.length });

    await ensureBucket();
    steps.bucketReady = true;
    const path = `diagnose-${storageKeyFor(pageUrl)}.png`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, png, {
      contentType: 'image/png',
      cacheControl: '60',
      upsert: true,
    });
    if (error) throw new Error(`upload failed: ${error.message}`);
    steps.uploaded = true;
    steps.url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    return { ok: true, ms: Date.now() - started, ...steps };
  } catch (err: any) {
    // The whole point: say which step died and why, rather than returning a fallback.
    return { ok: false, ms: Date.now() - started, ...steps, error: err?.message ?? String(err) };
  }
}
