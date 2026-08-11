// Calls Claude via the HF Space proxy (https://roanjtaylor-claudesubscription.hf.space),
// which uses the owner's Claude subscription — no API credits consumed.
// The HF Space streams SSE delta events; this file accumulates them, tracks live
// progress (counting completed JSON objects in the stream), and extracts the final JSON.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MODEL, HF_BASE_URL, HF_APP_SECRET } from '../config.ts';
import type {
  BoundaryKind,
  CoverageGap,
  Domain,
  EraGroup,
  FieldMapReview,
  FieldSummary,
  Item,
  MapAxis,
  ProposedItem,
  Subtopic,
  WorldMap,
} from '../../../shared/types.ts';

/** A resulting field from a boundary fix — either an existing field kept in a new
 *  shape, or a brand-new one split off from another. See `planBoundaryFix`. */
export interface BoundaryFieldPlan {
  /** The exact existing topic this replaces (a rename, or the surviving side of a
   *  merge), or "" for a field created fresh by a split. */
  sourceTopic: string;
  topic: string;
  description: string;
  subtopics: Subtopic[];
  /** Item ids, drawn from the pooled items of every field the issue named, that end
   *  up in this field. */
  itemIds: string[];
}

export interface BoundaryPlan {
  fields: BoundaryFieldPlan[];
  /** One short sentence describing what was done, shown to the person who accepted it. */
  note: string;
}

/** One line of domain context folded into every curation prompt (7-software-design.md) —
 *  the rules file's domain-aware section (curation-rules.md §f) only applies correctly
 *  once the model knows which world it's mapping. */
function domainLine(domain: Domain): string {
  return domain === 'digital'
    ? 'Domain: THE DIGITAL WORLD — this field lives on a screen: websites, apps, product UI, motion and graphics. There is no physical object; think in platforms, interaction patterns, and design eras.'
    : 'Domain: THE PHYSICAL WORLD — this field is work you can stand in front of or hold: objects, paintings, buildings, vehicles, printed matter.';
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'prompts', 'curation-rules.md');

/** Loaded fresh each call so edits to the rules file take effect without a restart. */
async function loadRules(): Promise<string> {
  return fs.readFile(RULES_PATH, 'utf8');
}

/** Pull a JSON value out of a model response, tolerating ```json fences / prose. */
function extractJson(text: string): any {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    const start = body.search(/[[{]/);
    const lastObj = body.lastIndexOf('}');
    const lastArr = body.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);
    if (start !== -1 && end > start) {
      return JSON.parse(body.slice(start, end + 1));
    }
    throw new Error('Could not parse JSON from model response.');
  }
}

export type ProgressFn = (line: string) => void;

interface RunOpts {
  onProgress?: ProgressFn;
  /**
   * Track live progress by counting completed JSON objects in the stream.
   * `key` is the field that appears once per object (e.g. "name"); `total` drives
   * "X of N" lines when known, otherwise "Found X…".
   */
  count?: { key: string; total?: number; noun: string };
  /** Hard cap on the whole call in ms. Defaults to 120 s (covers HF cold-start). */
  timeoutMs?: number;
}

/** One-shot prompt → parsed JSON via the HF Space /api/chat SSE endpoint. */
async function runJson(system: string, prompt: string, opts: RunOpts = {}): Promise<any> {
  const { onProgress, count, timeoutMs = 120_000 } = opts;

  // Say which knob is missing rather than letting the Space answer for us. Without
  // this the request goes out with an empty `x-app-secret`, the Space correctly
  // rejects it, and every AI feature fails with a bare "HF Space error 401:
  // unauthorized" — which reads like the proxy is broken when in fact this server was
  // never told the secret. The env var is `sync: false` in render.yaml (set in the
  // Render dashboard, deliberately not in the repo), so a machine that has working
  // Supabase credentials can still have no Claude access at all.
  if (!HF_APP_SECRET) {
    throw new Error(
      'HF_APP_SECRET is not set, so Claude cannot be reached. Add it to server/.env.local ' +
        '(the same value as HF_APP_SECRET in the Render dashboard) and restart the server.',
    );
  }

  onProgress?.('Reaching Claude…');

  const controller = new AbortController();
  // Distinguish OUR deadline from any other abort, so a timeout can say so instead of
  // surfacing fetch's bare "This operation was aborted" — which tells the user nothing
  // about what to do, and reads like a crash rather than a budget being hit.
  let timedOut = false;
  // Hoisted out of the read loop so the timeout handler below can report how far the
  // call got before the clock ran out.
  let lastCount = -1;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(`${HF_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'x-app-secret': HF_APP_SECRET,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: CLAUDE_MODEL,
        systemPrompt: system,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      // A 401 here means the secret was sent and refused — a different problem from
      // not having one, and worth distinguishing so the fix isn't guesswork.
      if (res.status === 401) {
        throw new Error(
          `The Claude proxy rejected this server's HF_APP_SECRET (401). Check it matches the ` +
            `secret the Space at ${HF_BASE_URL} expects.`,
        );
      }
      throw new Error(`HF Space error ${res.status}: ${text.slice(0, 200)}`);
    }

    onProgress?.('Claude is researching the field…');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let event = 'message';
        let data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;

        const parsed = JSON.parse(data);

        if (event === 'delta' && parsed.text) {
          accumulated += parsed.text as string;
          if (count && onProgress) {
            const n = (accumulated.match(new RegExp(`"${count.key}"\\s*:`, 'g')) || []).length;
            if (n > 0 && n !== lastCount) {
              lastCount = n;
              lastProgressAt = Date.now();
              const shown = count.total ? Math.min(n, count.total) : n;
              const noun = shown === 1 ? count.noun.replace(/s$/, '') : count.noun;
              onProgress(
                count.total
                  ? `Researching… ${shown} of ${count.total} ${noun}`
                  : `Found ${shown} ${noun}…`,
              );
            }
          }
          // A response can keep generating long after the counted key stops appearing
          // — the field-map review counts topics, then spends its whole tail on
          // regions and assignments, which contain none. The line would freeze on the
          // last count for minutes, so a working call was indistinguishable from a
          // hung one. This is the difference: still moving, and for how long.
          if (onProgress && Date.now() - lastProgressAt > 8_000) {
            lastProgressAt = Date.now();
            onProgress(`Still working… ${Math.round((Date.now() - startedAt) / 1000)}s`);
          }
        } else if (event === 'done') {
          streamDone = true;
          break;
        } else if (event === 'error') {
          throw new Error((parsed.error as string) ?? 'Claude error');
        }
      }
    }

    if (!accumulated) throw new Error('Empty response from Claude.');
    onProgress?.('Composing results…');
    return extractJson(accumulated);
  } catch (err: any) {
    if (timedOut) {
      // Report how far it got: a call that was clearly still producing work when the
      // clock ran out is a budget problem, and one that produced nothing in the same
      // time is a stuck request. Those want different responses from the user.
      const produced = lastCount > 0 ? ` It had produced ${lastCount} ${count?.noun ?? 'results'}.` : '';
      throw new Error(
        `Claude ran out of time after ${Math.round(timeoutMs / 1000)}s.${produced} ` +
          'Nothing was saved — try again, or narrow what you asked for.',
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const JSON_ONLY = 'Respond with valid JSON only — no markdown, no code fences, no prose.';

export async function proposeSubtopics(
  topic: string,
  description: string,
  domain: Domain,
  onProgress?: ProgressFn,
): Promise<{ subtopics: Subtopic[]; suggestedCount: number }> {
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;
  const prompt = `${domainLine(domain)}\n\nMacro topic: "${topic}"\nField description: "${description}"\n\nPropose the canonical SUBTOPICS for this field — its core themes/areas, the MINIMUM set of distinct categories that together cover the WHOLE field (see the subtopic-count rule). Use as few or as many as the field genuinely needs — do NOT aim for a fixed number; merge near-duplicates and split conflated themes.\n\nAlso suggest how many DEFINING ITEMS best represent this field as a whole — a single integer "suggestedCount" sized to the field's real breadth (typically 12–30; fewer for a narrow field, more for a sprawling one), enough for representative coverage without padding.\n\nReturn JSON of shape: { "subtopics": [ { "name": string, "description": string } ], "suggestedCount": number }`;
  const json = await runJson(system, prompt, { onProgress, count: { key: 'name', noun: 'themes' } });
  const subtopics = (json.subtopics ?? []) as Subtopic[];
  const raw = Number(json.suggestedCount);
  const suggestedCount = Number.isFinite(raw) ? Math.max(1, Math.min(50, Math.round(raw))) : 12;
  return { subtopics, suggestedCount };
}

/**
 * Propose the field's named era-periods.
 *
 * Called BEFORE items exist (the era-first curate flow), so `items` is optional:
 * with items it fits periods to the span actually present; without them it proposes
 * the field's whole plausible history, which then becomes the frame `generateItems`
 * is told to fill. That ordering is the point — "spread across eras" is an
 * instruction a model can quietly drift away from, "here are 5 eras, fill each" is
 * not (7-software-design.md, "make the era-spread fix structural").
 */
export async function proposePeriods(args: {
  topic: string;
  description: string;
  items?: Item[];
  domain: Domain;
}, onProgress?: ProgressFn): Promise<EraGroup[]> {
  const { topic, description, items = [], domain } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const years = items.map((i) => i.year).filter((y): y is number => typeof y === 'number');
  const currentYear = new Date().getFullYear();

  const spanLine = years.length
    ? `The work in this field spans roughly ${Math.min(...years)}–${Math.max(...years)}. Together the periods must cover that whole span (first period's start <= ${Math.min(...years)}, last period's end > ${Math.max(...years)}).`
    : `No items exist yet — so decide the span yourself: cover the field's WHOLE plausible history, from the earliest work that genuinely belongs to it through to ${currentYear}. Do not truncate the early end to the era you know best.`;

  const prompt = `${domainLine(domain)}\n\nMacro topic: "${topic}"\nField description: "${description}"\n\n${spanLine}\n\nPropose the canonical ERA-PERIODS for this field — the named time divisions a knowledgeable person uses to structure its history (e.g. art movements for paintings, design eras for product fields). Use as few or as many as the field genuinely needs; do NOT aim for a fixed number.\n\nRules:\n- Periods must be CONTIGUOUS and NON-OVERLAPPING (each period's "start" equals the previous period's "end").\n- "start" is inclusive, "end" is exclusive, both whole years.\n- Order from earliest to latest.\n\nReturn JSON of shape: { "eraGroups": [ { "label": string, "start": number, "end": number } ] }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'label', noun: 'periods' },
  });
  const raw = (json.eraGroups ?? []) as EraGroup[];
  return raw
    .filter(
      (g) =>
        g &&
        typeof g.label === 'string' &&
        Number.isFinite(g.start) &&
        Number.isFinite(g.end) &&
        g.end > g.start,
    )
    .map((g) => ({ label: g.label.trim(), start: Math.round(g.start), end: Math.round(g.end) }))
    .sort((a, b) => a.start - b.start);
}

/** The image-sourcing fields, which differ by domain — see attachImages() in
 *  routes/curation.ts and the resolver registry in services/imageResolvers.ts.
 *
 *  The physical world resolves one way (a Wikipedia lead photo) and needs one key. The
 *  digital world does not: only some of it is websites, so asking for a single `url`
 *  forced the model to invent one for things that never had one — VisiCalc, an IBM 3270
 *  terminal and a 1984 Macintosh all came back with Wikipedia ARTICLE urls, which the
 *  pipeline then dutifully screenshotted. Asking instead for a KIND plus several hints
 *  lets the server choose a resolver that can actually succeed, and lets it try more
 *  than one. */
function itemShapeLine(domain: Domain): string {
  if (domain !== 'digital') return '"subtopic": string, "wikipediaTitle": string';
  return [
    '"subtopic": string',
    '"imageKind": one of "archived-site" | "live-site" | "software-ui" | "artifact" — how a picture of this can actually be obtained:',
    '    "archived-site" = a WEBSITE whose PAST design you are showing (captured from the web archive near "year")',
    '    "live-site"     = a WEBSITE whose PRESENT design you are showing',
    '    "software-ui"   = software that is NOT a website: an operating system shell, desktop app, terminal, or anything pre-web',
    '    "artifact"      = a graphic work: an icon set, typeface, logo, poster, or a still from a motion piece',
    '"url": string — the canonical site address (e.g. "https://stripe.com"), ONLY for "archived-site"/"live-site". Use "" for the other two. NEVER a Wikipedia url',
    '"wikipediaTitle": string — the most likely English Wikipedia article title for this work, or "" if there plainly is none. Give this for EVERY item, including websites; it is the fallback when a capture fails',
    '"imageQuery": string — a precise phrase to find a picture of this in an image archive, e.g. "Mac OS System 7 Finder desktop screenshot" or "Susan Kare original Macintosh icons". Write it for a search engine, not as a title',
    '("year" is the year THIS SPECIFIC design/snapshot represents, which may be a past redesign, not necessarily today\'s look)',
  ].join(', ');
}

/**
 * Turn the field's era-periods into an explicit per-era quota for THIS request.
 *
 * This replaces the old prose nag ("please spread across time"), which the plan doc
 * itself judged "not fully load-bearing": a model asked for N items will happily
 * return N items clustered in the era it knows best, and an abstract spread
 * instruction doesn't stop it. Naming each era with a number beside it does — the
 * model has a checklist instead of an aspiration.
 *
 * Returns "" when the dataset has no era-periods (older datasets), so those keep the
 * previous behaviour rather than losing the instruction entirely.
 */
function eraQuotaLine(eraGroups: EraGroup[], count: number): string {
  if (!eraGroups.length) return '';

  // Even split, with the remainder handed to the most RECENT eras. Quotas always sum
  // to exactly `count`; recent eras get the spare item because they hold more
  // distinct, well-documented work than the thin early end of most fields.
  const base = eraGroups.map(() => Math.floor(count / eraGroups.length));
  for (let i = 0; i < count - base.reduce((a, b) => a + b, 0); i++) {
    base[base.length - 1 - i] += 1;
  }

  const quotas = eraGroups
    .map((g, i) => `- ${g.label} (${g.start}–${g.end - 1}): ${base[i]} item${base[i] === 1 ? '' : 's'}`)
    .join('\n');

  return `\n\nERA QUOTAS — this field's history is divided into these named periods, and your ${count} items must be distributed across them exactly as listed:\n${quotas}\n\nTreat this as a checklist, not a suggestion: an era with a quota of 0 is the only era you may return nothing for. Do not compensate for a hard era by adding extra items to an easier one. Each item's "year" must fall inside the period it is filling. Where a single long-lived product can represent several periods at different years, that is the ideal way to fill them — it is not a duplicate.`;
}

/**
 * The field's era-periods as context only, with no quota.
 *
 * Gap-filling is targeted by definition — the reported gaps say what's missing — so
 * forcing an even spread here would fight the request. The periods are still worth
 * naming: they keep an added item's `year` landing inside a real era of the field,
 * and they let a reported era gap be read against the actual period names.
 */
function eraReferenceLine(eraGroups: EraGroup[]): string {
  if (!eraGroups.length) return '';
  const periods = eraGroups.map((g) => `${g.label} (${g.start}–${g.end - 1})`).join('; ');
  return ` This field's named periods are: ${periods}. Each item's "year" should sit inside one of them, and where a gap names an era, fill that era specifically.`;
}

export async function generateItems(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  count: number;
  domain: Domain;
  eraGroups?: EraGroup[];
  existingItems?: Item[];
}, onProgress?: ProgressFn): Promise<ProposedItem[]> {
  const { topic, description, subtopics, count, domain, eraGroups = [], existingItems = [] } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const subtopicList = subtopics.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  const existingBlock = existingItems.length
    ? `\n\nThese items already exist — do NOT repeat them, and prefer filling areas they under-cover:\n${existingItems
        .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}]`)
        .join('\n')}`
    : '';

  const prompt = `${domainLine(domain)}\n\nMacro topic: "${topic}"\nField description: "${description}"\n\nCanonical subtopics (each item's "subtopic" MUST be exactly one of these names):\n${subtopicList}\n\nPropose ${count} defining items for this field. Spread them across the field's brands/makers, movements, eras and regions (breadth first), countering popularity bias.${eraQuotaLine(eraGroups, count)}${existingBlock}\n\nFill EVERY field. Return JSON of shape:\n{ "items": [ { "name": string, "description": string, "year": number|null, "brand": string, "creator": string, "definingFact": string, ${itemShapeLine(domain)} } ] }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'name', total: count, noun: 'items' },
    timeoutMs: 120_000 + count * 7_000,
  });
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  return items.map((it) => ({ ...it, image: '' }));
}

export async function findGaps(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  items: Item[];
  domain: Domain;
  eraGroups?: EraGroup[];
}, onProgress?: ProgressFn): Promise<{ gaps: CoverageGap[]; suggestedCount: number }> {
  const { topic, description, subtopics, items, domain, eraGroups = [] } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  // Each item's defining fact goes in, not just its name. A sweep that sees only names
  // can tell you which famous works are absent — the thing the model's prior already
  // knows — but not that two entries are covering the same ground under different
  // titles, or that a period is present by date and empty of what made it matter.
  // That reading is what turns this from a recall check into a coverage check.
  const inventory = items
    .map((i) => {
      const head = `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic || 'unfiled'}, ${i.year ?? '?'}]`;
      return i.definingFact ? `${head} — ${i.definingFact}` : head;
    })
    .join('\n');

  // The field's own named periods, so a gap can be reported in the vocabulary the
  // field already uses ("the Post-War period is thin") rather than in bare years the
  // user then has to map back onto their own timeline themselves.
  const periodLine = eraGroups.length
    ? `\nNamed periods: ${eraGroups.map((g) => `${g.label} (${g.start}–${g.end - 1})`).join('; ')}`
    : '';

  const prompt = `${domainLine(domain)}\n\nMacro topic: "${topic}"\nField description: "${description}"\nSubtopics: ${subtopics
    .map((s) => s.name)
    .join(', ')}${periodLine}\n\nCurrent items (${items.length}), each with its defining fact where one is recorded:\n${inventory || '(none yet)'}\n\nDo a breadth-first sweep of the WHOLE field and report what is thin or missing — brands/makers, movements, eras, regions, or subtopics that a representative set of this field should include but this set under-covers. Be concrete.\n\nJudge coverage by what each item CONTRIBUTES, not by the count: entries whose defining facts say the same thing cover one position between them, however different their names, and a period with items in it can still be thin if nothing in it represents what that period is known for.${eraGroups.length ? ' Where a gap is a period, name it by the period label above.' : ''}\n\nAlso suggest how many NEW items it would take to meaningfully close these gaps — a single integer "suggestedCount" sized to the breadth of what's missing (enough for representative coverage of the gaps without padding; 0 if coverage is already good).\n\nReturn JSON of shape: { "gaps": [ { "axis": string, "detail": string } ], "suggestedCount": number }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'axis', noun: 'gaps' },
  });
  const gaps = (json.gaps ?? []) as CoverageGap[];
  const raw = Number(json.suggestedCount);
  const fallback = Math.max(1, Math.min(20, gaps.length || 8));
  const suggestedCount = Number.isFinite(raw)
    ? Math.max(1, Math.min(50, Math.round(raw)))
    : fallback;
  return { gaps, suggestedCount };
}

/**
 * The world-level review (curation-rules.md §g): reads the SHELF — every field in one
 * world — and reports the map, the fields that are missing from it, boundaries drawn
 * wrong, and which existing fields look thin.
 *
 * Deliberately fed summaries, not items: this reasons about the shape of the map, and a
 * whole world's items would both swamp the prompt and pull the model down into per-item
 * critique, which `findGaps` already does properly per field.
 *
 * Works with an EMPTY shelf too — that call is "what are the fields of this world?",
 * which is exactly the question the digital world's hardcoded starter list used to
 * answer in TypeScript (web/src/lib/digitalFields.ts).
 */
/**
 * The spatial half of a review, before it's merged into the stored map.
 *
 * Fields and regions are referenced by NAME here, not by id — the model reads and
 * writes topic names, and asking it to echo UUIDs correctly is a needless way to lose
 * an assignment. The route resolves names to ids where it has the mapping.
 *
 * `axes` and `regions` are absent when a map already exists: they are settled, and the
 * route will not take them from a model response even if one arrives anyway.
 */
export interface MapProposal {
  axes?: { x: MapAxis; y: MapAxis };
  regions: Array<{ name: string; description: string; x: number; y: number }>;
  assignments: Array<{ field: string; region: string }>;
  suggestions: Array<
    | { kind: 'add-region'; why: string; region: { name: string; description: string; x: number; y: number } }
    | { kind: 'move-field'; why: string; field: string; toRegion: string }
    | { kind: 'rename-region'; why: string; region: string; name: string }
  >;
}

/** Clamp to the 0–1 the axes are defined on; a model occasionally answers in percent. */
function unitScale(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0.5;
  if (n > 1 && n <= 100) return Math.min(1, Math.max(0, n / 100));
  return Math.min(1, Math.max(0, n));
}

function parseRegion(raw: any): { name: string; description: string; x: number; y: number } | null {
  const name = String(raw?.name ?? '').trim();
  if (!name) return null;
  return {
    name,
    description: String(raw.description ?? '').trim(),
    x: unitScale(raw.x),
    y: unitScale(raw.y),
  };
}

function parseMapProposal(json: any, existingMap: WorldMap | null): MapProposal {
  // Regions and axes are only ever read from a response when there is no settled map.
  // This is the structural half of the stability guarantee: the prompt asks the model
  // to leave them alone, and this makes it so even when the model doesn't.
  const regions = existingMap
    ? []
    : ((json.regions ?? []) as any[]).map(parseRegion).filter((r): r is NonNullable<typeof r> => !!r);

  const axesRaw = json.axes;
  const axes =
    existingMap || !axesRaw?.x?.label || !axesRaw?.y?.label
      ? undefined
      : {
          x: {
            label: String(axesRaw.x.label).trim(),
            low: String(axesRaw.x.low ?? '').trim(),
            high: String(axesRaw.x.high ?? '').trim(),
          },
          y: {
            label: String(axesRaw.y.label).trim(),
            low: String(axesRaw.y.low ?? '').trim(),
            high: String(axesRaw.y.high ?? '').trim(),
          },
        };

  const assignments = ((json.assignments ?? []) as any[])
    .filter((a) => a?.field && a?.region)
    .map((a) => ({ field: String(a.field).trim(), region: String(a.region).trim() }));

  const suggestions = ((json.suggestions ?? []) as any[])
    .map((s): MapProposal['suggestions'][number] | null => {
      const why = String(s?.why ?? '').trim();
      switch (String(s?.kind)) {
        case 'add-region': {
          const region = parseRegion(s.region);
          return region ? { kind: 'add-region', why, region } : null;
        }
        case 'move-field':
          return s.field && s.toRegion
            ? { kind: 'move-field', why, field: String(s.field).trim(), toRegion: String(s.toRegion).trim() }
            : null;
        case 'rename-region':
          return s.region && s.name
            ? { kind: 'rename-region', why, region: String(s.region).trim(), name: String(s.name).trim() }
            : null;
        default:
          return null;
      }
    })
    .filter((s): s is MapProposal['suggestions'][number] => !!s)
    // A cap the prompt also asks for: a review that returns twenty changes is not a
    // review, it's a redraw, and accepting them one by one stops being feasible.
    .slice(0, 4);

  return { axes, regions, assignments, suggestions };
}

export async function reviewFieldMap(args: {
  domain: Domain;
  fields: FieldSummary[];
  /** The stored map, when one exists. Its axes and regions are treated as settled. */
  existingMap?: WorldMap | null;
}, onProgress?: ProgressFn): Promise<FieldMapReview & { proposal: MapProposal }> {
  const { domain, fields, existingMap = null } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const inventory = fields.length
    ? fields
        .map((f) => {
          const span = f.yearRange ? `${f.yearRange.min}–${f.yearRange.max}` : 'undated';
          const subs = f.subtopics.length ? f.subtopics.join(', ') : '(none)';
          return `- ${f.topic} — ${f.description}\n    ${f.itemCount} items, ${span}, subtopics: ${subs}`;
        })
        .join('\n')
    : '(no fields built yet — this world is empty)';

  // The two modes of the spatial half. Drawing a map from nothing and amending one
  // that already exists are different jobs, and conflating them is what would make
  // the map churn between visits.
  const mapBlock = existingMap
    ? `\n\nTHE MAP ALREADY EXISTS, AND IS SETTLED. Do not re-derive, rename, reorder or re-position the axes or regions below.\n\nAxes:\n- x: ${existingMap.axes.x.label} (${existingMap.axes.x.low} → ${existingMap.axes.x.high})\n- y: ${existingMap.axes.y.label} (${existingMap.axes.y.low} → ${existingMap.axes.y.high})\n\nRegions:\n${existingMap.regions.map((r) => `- ${r.name} — ${r.description}`).join('\n')}\n\nFor the map, return:\n5. "assignments" — one entry per field ABOVE and per field you list in "missingFields", giving the region it belongs to. "field" must match a topic exactly as written; "region" must be one of the region names above.\n6. "suggestions" — at most 4 changes to the map, or an empty array. Each is one of:\n   { "kind": "add-region", "why": string, "region": { "name": string, "description": string, "x": number, "y": number } }\n   { "kind": "move-field", "why": string, "field": "<an existing topic>", "toRegion": "<a region name>" }\n   { "kind": "rename-region", "why": string, "region": "<current region name>", "name": "<better name>" }\n\nLeave "axes" and "regions" out of your response entirely — they are settled.`
    : `\n\nTHIS WORLD HAS NO MAP YET — draw one (see the spatial-map rule). Return:\n5. "axes" — the two dimensions this whole world is best laid out on. Each has a "label" and a named "low" and "high" end. They must be concrete enough that any field in this world can be confidently placed on both.\n6. "regions" — the named areas of this world. Few, genuinely distinct, together covering it. Each needs a "name", a one-line "description", and an "x" and "y" between 0 and 1 giving where it sits on those two axes. Spread them out: regions that would sit in the same place probably want merging.\n7. "assignments" — one entry per field ABOVE and per field you list in "missingFields", giving the region it belongs to. "field" must match a topic exactly as written; "region" must be one of your region names.\n\nReturn "suggestions" as an empty array — there is no existing map to change.`;

  const prompt = `${domainLine(domain)}\n\nThis is a WORLD-LEVEL review (see the field-map rule). Below is every field the user has built in this world, each with its description, item count, dated year span, and subtopic names. The items themselves are deliberately not included.\n\nFields built so far:\n${inventory}\n\nReview this collection AS A MAP OF THE WHOLE WORLD:\n1. "mapSummary" — one paragraph on how this world genuinely divides into fields, and what a complete map of it would look like.\n2. "missingFields" — fields of this world with no dataset yet. Give each a "topic" and "description" ready to start a new dataset with, plus "why" it matters. Favour the ones the user is least likely to have thought of.\n3. "boundaryIssues" — existing fields drawn wrong: "kind" is exactly one of "merge", "split", or "rename"; "fields" lists the existing topic name(s) involved, EXACTLY as written above; "proposal" is the concrete change; "why" is the reason. Return an empty array if the boundaries are sound.\n4. "thinFields" — existing fields that look under-built or skewed, judged only from the counts, spans and subtopics above. "topic" must match an existing field name exactly. Empty array if none.${mapBlock}\n\nReturn JSON of shape: { "mapSummary": string, "missingFields": [ { "topic": string, "description": string, "why": string } ], "boundaryIssues": [ { "kind": string, "fields": [string], "proposal": string, "why": string } ], "thinFields": [ { "topic": string, "detail": string } ], "axes": { "x": { "label": string, "low": string, "high": string }, "y": { "label": string, "low": string, "high": string } }, "regions": [ { "name": string, "description": string, "x": number, "y": number } ], "assignments": [ { "field": string, "region": string } ], "suggestions": [ ... ] }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'topic', noun: 'fields' },
    // This is the largest single response the app asks for — a summary paragraph,
    // missing fields each with a rationale, boundary issues, thin fields, and (on a
    // first draw) two axes, every region, and one assignment per field. It grows with
    // the shelf, so a fixed budget is wrong in exactly the way it was: the biggest job
    // had the smallest one, and a first draw of a well-stocked world timed out
    // mid-stream. Drawing from scratch costs roughly double amending an existing map.
    timeoutMs: (existingMap ? 150_000 : 240_000) + fields.length * 9_000,
  });

  const known = new Set(fields.map((f) => f.topic));
  const kinds = new Set(['merge', 'split', 'rename']);

  return {
    mapSummary: typeof json.mapSummary === 'string' ? json.mapSummary.trim() : '',
    missingFields: ((json.missingFields ?? []) as any[])
      // A "missing" field that already exists is a model slip, not a gap — drop it
      // rather than sending the user to curate a duplicate of what they're looking at.
      .filter((m) => m?.topic && !known.has(String(m.topic).trim()))
      .map((m) => ({
        topic: String(m.topic).trim(),
        description: String(m.description ?? '').trim(),
        why: String(m.why ?? '').trim(),
      })),
    boundaryIssues: ((json.boundaryIssues ?? []) as any[])
      .filter((b) => b?.proposal && kinds.has(String(b.kind)))
      .map((b) => ({
        kind: String(b.kind) as BoundaryKind,
        fields: (Array.isArray(b.fields) ? b.fields : []).map((f: unknown) => String(f).trim()),
        proposal: String(b.proposal).trim(),
        why: String(b.why ?? '').trim(),
      })),
    thinFields: ((json.thinFields ?? []) as any[])
      .filter((t) => t?.topic && known.has(String(t.topic).trim()))
      .map((t) => ({ topic: String(t.topic).trim(), detail: String(t.detail ?? '').trim() })),
    proposal: parseMapProposal(json, existingMap),
  };
}

/**
 * Turn an accepted `BoundaryIssue` into a concrete plan — which resulting field(s)
 * exist, in what shape, and which of the involved items land in each. The route
 * (routes/curation.ts) then carries the plan out: updating, creating and deleting
 * datasets as it requires.
 *
 * Only fed the involved field(s)' items (id, name, subtopic, year) rather than their
 * full records — the same "reason about shape, not content" split as `findGaps` and
 * `reviewFieldMap`, and per-item ids are all the apply step needs back.
 */
export async function planBoundaryFix(args: {
  domain: Domain;
  kind: BoundaryKind;
  proposal: string;
  why: string;
  fields: Array<{
    topic: string;
    description: string;
    subtopics: Subtopic[];
    items: Array<{ id: string; name: string; subtopic: string; year: number | null }>;
  }>;
}, onProgress?: ProgressFn): Promise<BoundaryPlan> {
  const { domain, kind, proposal, why, fields } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const fieldBlock = fields
    .map((f) => {
      const subs = f.subtopics.map((s) => s.name).join(', ') || '(none)';
      const items = f.items
        .map((i) => `  - ${i.id}: ${i.name} [${i.subtopic || 'unfiled'}, ${i.year ?? '?'}]`)
        .join('\n');
      return `Field "${f.topic}" — ${f.description}\nSubtopics: ${subs}\nItems (${f.items.length}):\n${items || '  (none)'}`;
    })
    .join('\n\n');

  const prompt = `${domainLine(domain)}\n\nA world-level review flagged a boundary problem between these existing field(s):\n\n${fieldBlock}\n\nProblem (kind: "${kind}"): ${proposal}\nReason: ${why}\n\nWork out the concrete result of applying this fix. Account for EVERY item id listed above exactly once across your "fields" — none may be dropped, none duplicated.\n\nReturn "fields", one entry per resulting field:\n- For a field that keeps one of the existing topics above (a rename, or the surviving side of a merge), set "sourceTopic" to that EXACT existing topic name.\n- For a brand-new field created by a split, set "sourceTopic" to "".\n- "topic" is the field's final name (same as sourceTopic when nothing is renamed).\n- "description" is its final description.\n- "subtopics" is its final canonical subtopic list.\n- "itemIds" lists which of the item ids above end up in this field.\n\nReturn JSON of shape: { "fields": [ { "sourceTopic": string, "topic": string, "description": string, "subtopics": [ { "name": string, "description": string } ], "itemIds": [string] } ], "note": string }\n\n"note" is one short sentence describing what you did, shown to the person who accepted this fix.`;

  const totalItems = fields.reduce((n, f) => n + f.items.length, 0);
  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'sourceTopic', noun: 'fields' },
    timeoutMs: 90_000 + totalItems * 400,
  });

  const knownIds = new Set(fields.flatMap((f) => f.items.map((i) => i.id)));
  const resultFields: BoundaryFieldPlan[] = ((json.fields ?? []) as any[])
    .filter((f) => f?.topic)
    .map((f) => ({
      sourceTopic: String(f.sourceTopic ?? '').trim(),
      topic: String(f.topic).trim(),
      description: String(f.description ?? '').trim(),
      subtopics: (Array.isArray(f.subtopics) ? f.subtopics : [])
        .filter((s: any) => s?.name)
        .map((s: any) => ({
          name: String(s.name).trim(),
          description: String(s.description ?? '').trim(),
        })),
      itemIds: (Array.isArray(f.itemIds) ? f.itemIds : [])
        .map((id: unknown) => String(id))
        .filter((id: string) => knownIds.has(id)),
    }));

  // Anything the model dropped stays exactly where it was — assigned back into a
  // field carrying its original topic (creating one if every field it named was
  // renamed away), so a slip in the plan can never quietly lose an item.
  const assigned = new Set(resultFields.flatMap((f) => f.itemIds));
  for (const f of fields) {
    for (const it of f.items) {
      if (assigned.has(it.id)) continue;
      let home = resultFields.find((r) => r.sourceTopic === f.topic);
      if (!home) {
        home = {
          sourceTopic: f.topic,
          topic: f.topic,
          description: f.description,
          subtopics: f.subtopics,
          itemIds: [],
        };
        resultFields.push(home);
      }
      home.itemIds.push(it.id);
    }
  }

  return { fields: resultFields, note: typeof json.note === 'string' ? json.note.trim() : '' };
}

export async function fillGaps(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  existingItems: Item[];
  gaps: CoverageGap[];
  count: number;
  feedback: string;
  domain: Domain;
  eraGroups?: EraGroup[];
}, onProgress?: ProgressFn): Promise<{ items: ProposedItem[]; note: string }> {
  const { topic, description, subtopics, existingItems, gaps, count, feedback, domain, eraGroups = [] } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const subtopicList = subtopics.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  const existingBlock = existingItems.length
    ? existingItems
        .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}]`)
        .join('\n')
    : '(none yet)';
  const gapBlock = gaps.length
    ? gaps.map((g) => `- ${g.axis}: ${g.detail}`).join('\n')
    : '(no specific gaps were reported — use your own breadth-first judgement)';
  const feedbackBlock = feedback.trim()
    ? `\n\nThe user gave this feedback on what to add:\n"""\n${feedback.trim()}\n"""\nTreat it as a HYPOTHESIS to evaluate against the curation rules and the field's objective reality, NOT an order. Where it names work that genuinely belongs (objectively defining/representative of the field), include it. Where a request would NOT improve objective coverage — popularity bias, already covered, out of scope, or not actually defining — do NOT include it. Either way, account for every distinct request in your "note".`
    : '';

  const prompt = `${domainLine(domain)}\n\nMacro topic: "${topic}"\nField description: "${description}"\n\nCanonical subtopics (each item's "subtopic" MUST be exactly one of these names):\n${subtopicList}\n\nItems already in the set — do NOT repeat these:\n${existingBlock}\n\nReported coverage gaps to close (breadth first):\n${gapBlock}${feedbackBlock}\n\nPropose ${count} NEW defining items that best close these gaps and widen the field's coverage, countering popularity bias.${eraReferenceLine(eraGroups)} Fill EVERY field.\n\nReturn JSON of shape:\n{ "items": [ { "name": string, "description": string, "year": number|null, "brand": string, "creator": string, "definingFact": string, ${itemShapeLine(domain)} } ], "note": string }\n\nThe "note" is a short, plain-language explanation (2–5 sentences) of how you handled the gaps and the user's feedback: what you added and why, and for any user request you did NOT include, a clear reason why.`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'name', total: count, noun: 'items' },
    timeoutMs: 120_000 + count * 7_000,
  });
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  const note = typeof json.note === 'string' ? json.note : '';
  return { items: items.map((it) => ({ ...it, image: '' })), note };
}
