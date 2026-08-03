// Audit (and repair) taste_datasets.slug.
//
// The app's URLs are now /physical/ships — the dataset is addressed by its slug, and
// the server resolves that slug straight to a row. Rows written before that only ever
// had their slug read by nothing, so a topic renamed at some point could leave the
// column holding the *old* name; such a dataset is unreachable at the link the shelf
// builds for it (which comes from the current topic). This brings every row back in
// line with slugifyTopic(topic), the single rule both sides now use.
//
//   npx tsx scripts/backfill-slugs.mts          # report only
//   npx tsx scripts/backfill-slugs.mts --fix    # write the corrections
//
// Credentials come from server/.env.local (or the ambient environment on a server).
// Safe to re-run: it only ever writes the slug a topic already implies.
import '../server/src/env.ts';
import { createClient } from '@supabase/supabase-js';
import { slugifyTopic } from '../shared/types.ts';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or fill server/.env.local).');
  process.exit(1);
}

const supabase = createClient(url, key);
const fix = process.argv.includes('--fix');

const { data, error } = await supabase.from('taste_datasets').select('id, slug, data');
if (error) throw new Error(error.message);

const rows = (data ?? []).map((row: any) => ({
  id: row.id as string,
  slug: (row.slug ?? '') as string,
  topic: (row.data?.topic ?? '') as string,
  domain: (row.data?.domain ?? '') as string,
  want: slugifyTopic(row.data?.topic ?? ''),
}));

for (const row of rows) {
  const mark = row.slug === row.want ? 'ok   ' : 'DRIFT';
  console.log(
    `${mark} ${row.domain.padEnd(9)} ${row.topic.padEnd(24)} ${row.slug.padEnd(26)} -> ${row.want}`,
  );
}

const drift = rows.filter((r) => r.slug !== r.want);

// Two topics that slugify the same can't both own the address, and the column is
// UNIQUE — so this is a rename the person has to make, not something to guess at.
const counts = new Map<string, string[]>();
for (const r of rows) counts.set(r.want, [...(counts.get(r.want) ?? []), r.topic]);
const collisions = [...counts].filter(([, topics]) => topics.length > 1);

console.log(`\n${rows.length} datasets · ${drift.length} drifted · ${collisions.length} collisions`);
for (const [slug, topics] of collisions) {
  console.log(`  collision on "${slug}": ${topics.join(', ')} — rename one of these.`);
}

if (!fix) {
  if (drift.length) console.log('\nRe-run with --fix to write the corrections.');
  process.exit(0);
}

if (collisions.length) {
  console.error('\nRefusing to write while two topics claim one address.');
  process.exit(1);
}

for (const row of drift) {
  const { error: writeError } = await supabase
    .from('taste_datasets')
    .update({ slug: row.want })
    .eq('id', row.id);
  if (writeError) throw new Error(`${row.topic}: ${writeError.message}`);
  console.log(`fixed ${row.topic}: "${row.slug}" -> "${row.want}"`);
}
console.log(`\n${drift.length} row(s) updated.`);
