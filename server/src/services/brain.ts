// The app's Claude setup, described as data (shared/types.ts's `BrainSetup`) and served
// by GET /api/brain for the settings cog to draw.
//
// Two halves:
//   - CATALOGUE: a hand-written description of each call — hand-written because "what
//     this call is for" and "what the code checks afterwards" aren't derivable from a
//     template string. It is kept honest structurally: `runJson` (services/claude.ts)
//     requires a `BrainCallId` for every call, so a new prompt can't be added without
//     the type — and therefore this list — being extended.
//   - RUN LOG: the last REAL run of each call — the exact prompt sent, how long it
//     took, whether it worked. The catalogue says what a call is meant to do; this
//     says what it actually did. In memory only: it resets with the server.
import type { BrainCall, BrainCallId, BrainRun } from '../../../shared/types.ts';

const startedAt = new Date().toISOString();
export const serverStartedAt = () => startedAt;

const lastRuns = new Map<BrainCallId, BrainRun>();

export function recordRun(id: BrainCallId, run: BrainRun) {
  lastRuns.set(id, run);
}

const ITEM_SHAPE =
  'name, description, year, brand, creator, definingFact, subtopic + image-sourcing hints ' +
  '(physical: wikipediaTitle, imageQuery · digital: imageKind, url, wikipediaTitle, imageQuery)';

const CATALOGUE: Array<Omit<BrainCall, 'lastRun'>> = [
  {
    id: 'subtopics',
    name: 'Map the field — themes',
    level: 'field',
    trigger: 'New dataset → “Map the field” (runs alongside the periods call)',
    purpose:
      'Proposes the minimum set of distinct subtopics that together cover the whole field, and how many items would represent it.',
    inputs: ['World (physical/digital) line', 'Topic', 'Field description'],
    output: '{ subtopics: [{ name, description }], suggestedCount }',
    rules: ['(a) Field-mapping', '(a2) Subtopic count', '(f) Digital world'],
    guardrails: ['suggestedCount clamped to 1–50 (falls back to 12)'],
    durable: true,
  },
  {
    id: 'periods',
    name: 'Map the field — era-periods',
    level: 'field',
    trigger: 'New dataset → “Map the field” (runs alongside the themes call)',
    purpose:
      'Names the field’s eras BEFORE any items exist, so research can be given a per-era quota instead of a vague “spread across time”.',
    inputs: [
      'World line',
      'Topic',
      'Field description',
      'The year span of existing items, if any — otherwise told to cover the field’s whole plausible history',
    ],
    output: '{ eraGroups: [{ label, start, end }] } — contiguous, non-overlapping',
    rules: ['(a) Field-mapping', '(f) Digital world'],
    guardrails: [
      'Invalid ranges dropped; sorted by start year',
      'Best-effort: if it fails, the field is mapped without periods rather than failing',
    ],
    durable: true,
  },
  {
    id: 'items',
    name: 'Research the defining items',
    level: 'field',
    trigger: 'New dataset → “Research N items”',
    purpose:
      'Proposes the defining work of the field, breadth-first, against the subtopics and era quotas — shown for review before anything is saved.',
    inputs: [
      'World line',
      'Topic + description',
      'Canonical subtopics (each item must use one exactly)',
      'ERA QUOTAS computed in code: the count split evenly across periods, remainder to the most recent',
      'Existing items, if any (do-not-repeat list)',
    ],
    output: `{ items: [{ ${ITEM_SHAPE} }] }`,
    rules: ['(a) Field-mapping', '(b) Anti-bias', '(c) Dedup', '(d) Field-filling', '(f) Digital world'],
    guardrails: [
      'Count clamped to 1–50',
      'Images are NOT from Claude: a separate scored multi-source pipeline resolves them from the hints',
      'Review-before-save: nothing is written until you accept',
    ],
    durable: true,
  },
  {
    id: 'gaps',
    name: 'Review — find what I’m missing',
    level: 'field',
    trigger: 'Dataset → Review → “Find what I’m missing” (also the world review’s “Expand dataset →”)',
    purpose:
      'A breadth-first sweep of the whole field that reports what is thin or absent — the unknown-unknowns. Judges coverage by what each item contributes, not by count.',
    inputs: [
      'World line',
      'Topic + description',
      'Subtopic names',
      'Named periods',
      'Every item: name, brand, subtopic, year AND its defining fact',
      'Optional focus — read one area more closely, still sweep everything',
    ],
    output: '{ gaps: [{ axis, detail }], suggestedCount }',
    rules: ['(a) Field-mapping', '(b) Anti-bias'],
    guardrails: ['suggestedCount clamped to 1–50'],
    durable: true,
  },
  {
    id: 'gap-fill',
    name: 'Expand — fill the reported gaps',
    level: 'field',
    trigger: 'Dataset → after a sweep → “Research N to add”',
    purpose:
      'Researches new items that close the sweep’s gaps. Your optional steer is treated as a HYPOTHESIS weighed against the rules, not an order — every request is accounted for in the note.',
    inputs: [
      'World line',
      'Topic + description',
      'Canonical subtopics',
      'Existing items with subtopic and year (do-not-repeat list)',
      'The reported gaps',
      'Your steer, if any',
      'Named periods as context (no quota — gap-filling is targeted)',
    ],
    output: `{ items: [{ ${ITEM_SHAPE} }], note }`,
    rules: ['(b) Anti-bias', '(c) Dedup', '(c2) Steers vs direct requests', '(d) Field-filling'],
    guardrails: [
      'Count clamped to 1–50',
      'Repeats of existing items dropped in code (name + brand) before images are fetched',
      'Off-list subtopics blanked so you must pick one',
      'Review-before-save',
    ],
    durable: true,
  },
  {
    id: 'direct-request',
    name: 'Expand — direct request',
    level: 'field',
    trigger: 'Dataset → Review → “Ask for something specific”',
    purpose:
      'No sweep: your words ARE the brief and Claude follows them. The rules govern how it chooses within the brief, not whether to follow it. Returns fewer rather than padding.',
    inputs: [
      'World line',
      'Topic + description',
      'Canonical subtopics',
      'Existing items with subtopic and year (do-not-repeat list)',
      'Your request, verbatim',
      'Named periods as context',
    ],
    output: `{ items: [{ ${ITEM_SHAPE} }], note }`,
    rules: ['(c) Dedup', '(c2) Steers vs direct requests', '(d) Field-filling'],
    guardrails: [
      'An empty request is refused before any Claude call',
      'Same code-side dedup, subtopic check and review-before-save as gap-fill',
    ],
    durable: true,
  },
  {
    id: 'field-map',
    name: 'Check this world',
    level: 'world',
    trigger: 'World → Review',
    purpose:
      'Audits the SHELF, not one field: how the world really divides, which fields are missing, which boundaries are drawn wrong, which fields are thin — and draws or amends the 2D map.',
    inputs: [
      'World line',
      'Every field as a SUMMARY: topic, description, item count, year span, subtopic names (items deliberately excluded)',
      'The existing map’s axes and regions, marked SETTLED — or an instruction to draw one',
    ],
    output:
      '{ mapSummary, missingFields, boundaryIssues, thinFields, axes?, regions?, assignments, suggestions }',
    rules: ['(g) The field map', '(g2) The spatial map'],
    guardrails: [
      'Axes/regions in the reply are IGNORED when a map already exists — stability is enforced in code, not just asked for',
      '“Missing” fields that already exist are dropped; names forced to one word',
      'Multi-word field names raised as a rename in code even if the model misses them',
      'Map suggestions capped at 4',
    ],
    durable: false,
  },
  {
    id: 'boundary-shape',
    name: 'Boundary fix — shape',
    level: 'world',
    trigger: 'World review → “Accept changes” on a merge / split / rename (stage 1 of 2)',
    purpose:
      'Decides which fields exist once the fix is applied — names, descriptions, subtopics — with no items in the prompt, so it stays small however big the fields are.',
    inputs: [
      'World line',
      'The involved fields: description, subtopics, item COUNT',
      'The issue’s kind, proposal and reason',
      'A kind-specific line on how the number of fields must change',
    ],
    output: '{ fields: [{ sourceTopic, topic, description, subtopics }], note }',
    rules: ['(a2) Subtopic count', '(g) The field map'],
    guardrails: [
      'A “split” that returns no extra field is re-asked once, naming the mistake',
      'Topics forced to one word',
    ],
    durable: false,
  },
  {
    id: 'boundary-classify',
    name: 'Boundary fix — classify items',
    level: 'world',
    trigger: 'World review → “Accept changes” (stage 2 of 2)',
    purpose:
      'Assigns every involved item to one of the resulting fields, in batches of 40 run 4 at a time, so output size never scales with the field.',
    inputs: ['World line', 'The resulting fields from stage 1', 'A batch of items: id, name, current field, subtopic, year'],
    output: '{ assignments: [{ id, topic }] }',
    rules: ['(g) The field map'],
    guardrails: [
      'Assignments to unknown topics ignored',
      'Any item left unassigned stays in its original field — a slip can never lose an item',
    ],
    durable: false,
  },
];

export function brainCalls(): BrainCall[] {
  return CATALOGUE.map((c) => ({ ...c, lastRun: lastRuns.get(c.id) ?? null }));
}
