#!/usr/bin/env node
// One-shot migration: reads the local JSON files and upserts them into Supabase.
// Run once after creating the Supabase tables:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-to-supabase.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATASETS_DIR = path.join(ROOT, 'data', 'datasets');
const RESULTS_DIR = path.join(ROOT, 'data', 'results');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function slugify(topic) {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function migrateDatasets() {
  let files;
  try {
    files = (await fs.readdir(DATASETS_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    console.log('No data/datasets directory found — nothing to migrate.');
    return;
  }

  for (const file of files) {
    const ds = await readJson(path.join(DATASETS_DIR, file));
    if (!ds) continue;

    const { error } = await supabase.from('taste_datasets').upsert({
      id: ds.id,
      slug: slugify(ds.topic),
      data: ds,
      updated_at: ds.updatedAt,
    });

    if (error) {
      console.error(`  ✗ Dataset ${file}: ${error.message}`);
    } else {
      console.log(`  ✓ Dataset "${ds.topic}" (${ds.items?.length ?? 0} items)`);
    }
  }
}

async function migrateResults() {
  let files;
  try {
    files = (await fs.readdir(RESULTS_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    console.log('No data/results directory found — nothing to migrate.');
    return;
  }

  for (const file of files) {
    const results = await readJson(path.join(RESULTS_DIR, file));
    if (!results) continue;

    const { error } = await supabase.from('taste_comparison_results').upsert({
      dataset_id: results.datasetId,
      data: results,
      updated_at: results.updatedAt,
    });

    if (error) {
      console.error(`  ✗ Results ${file}: ${error.message}`);
    } else {
      const ratingCount = Object.keys(results.ratings ?? {}).length;
      console.log(`  ✓ Results for dataset ${results.datasetId} (${ratingCount} ratings)`);
    }
  }
}

console.log('Migrating datasets…');
await migrateDatasets();
console.log('Migrating comparison results…');
await migrateResults();
console.log('Done.');
