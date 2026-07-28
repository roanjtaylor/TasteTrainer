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
  browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

const MAX_CONCURRENT_RENDERS = 2;
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

/**
 * Screenshot `pageUrl` with a browser we fully control. `blockLiveRequests` should
 * be true for Wayback Machine snapshot urls: it aborts any request whose host isn't
 * archive.org, forcing the page to render only from what was actually archived
 * instead of quietly re-hydrating from the live web. Throws on failure — the
 * caller decides the fallback.
 */
async function renderScreenshot(pageUrl: string, blockLiveRequests: boolean): Promise<Buffer> {
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
      return (await page.screenshot({ type: 'png' })) as Buffer;
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
export async function renderAndStore(pageUrl: string, blockLiveRequests: boolean): Promise<string> {
  await ensureBucket();
  const path = `${storageKeyFor(pageUrl)}.png`;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  if (await existingPublicUrl(data.publicUrl)) return data.publicUrl;

  const png = await renderScreenshot(pageUrl, blockLiveRequests);
  const { error } = await supabase.storage.from(BUCKET).upload(path, png, {
    contentType: 'image/png',
    cacheControl: IMAGE_CACHE_SECONDS,
    upsert: true,
  });
  if (error) throw new Error(`Could not upload screenshot: ${error.message}`);
  return data.publicUrl;
}
