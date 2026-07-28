#!/usr/bin/env node
// Rewrite the cache lifetime on screenshots uploaded before that was set explicitly.
//
// Supabase Storage defaults objects to `cache-control: max-age=3600`, so every browser
// re-downloaded every screenshot roughly hourly — pure egress, since these objects are
// content-addressed (the key is a hash of the exact page url) and their bytes can never
// change. screenshotRender.ts now uploads with a one-year lifetime; this backfills the
// ones already stored.
//
// The lifetime is per-object metadata that can only be set on write, so each file has to
// be read back and re-uploaded. That costs one download per screenshot, once — after
// which every viewer fetches each image at most once a year instead of hourly.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/refresh-image-cache.mjs
//
// Safe to re-run and safe to interrupt: it re-uploads identical bytes under the same key,
// so a partial run just means the rest still have the old header.
import { createClient } from '@supabase/supabase-js';

const BUCKET = 'software-screenshots';
const CACHE_SECONDS = '31536000'; // supabase-js sends this as `max-age=${value}`
const PAGE_SIZE = 100;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const storage = supabase.storage.from(BUCKET);

let offset = 0;
let updated = 0;
let failed = 0;

for (;;) {
  const { data: files, error } = await storage.list('', { limit: PAGE_SIZE, offset });
  if (error) {
    console.error(`Could not list "${BUCKET}": ${error.message}`);
    process.exit(1);
  }
  if (!files?.length) break;

  for (const file of files) {
    // `list` returns a placeholder row for the bucket root on some projects; skip
    // anything that isn't one of our .png objects.
    if (!file.name?.endsWith('.png')) continue;

    const { data: blob, error: downloadError } = await storage.download(file.name);
    if (downloadError || !blob) {
      console.error(`  ✗ ${file.name}: ${downloadError?.message ?? 'download returned nothing'}`);
      failed += 1;
      continue;
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    const { error: uploadError } = await storage.upload(file.name, bytes, {
      contentType: 'image/png',
      cacheControl: CACHE_SECONDS,
      upsert: true,
    });
    if (uploadError) {
      console.error(`  ✗ ${file.name}: ${uploadError.message}`);
      failed += 1;
      continue;
    }

    updated += 1;
    if (updated % 25 === 0) console.log(`  … ${updated} refreshed`);
  }

  if (files.length < PAGE_SIZE) break;
  offset += files.length;
}

console.log(`Done. ${updated} screenshot(s) now cache for a year${failed ? `, ${failed} failed` : ''}.`);
