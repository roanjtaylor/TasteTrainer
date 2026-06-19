// Talks to Claude via the Claude Agent SDK, using whatever credentials the local
// environment already has. With no ANTHROPIC_API_KEY set it uses your Claude
// subscription login (the OAuth token in ~/.claude/.credentials.json, same as
// Claude Code) — so curation draws on your plan, not pay-per-use API credits. If
// ANTHROPIC_API_KEY *is* set in the environment, the SDK prefers it and bills
// credits. No key is hardcoded here. See plan/3-curation.md for the full picture.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MODEL } from '../config.ts';
import type { CoverageGap, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

// The Agent SDK doesn't call an HTTP API directly — it spawns a full Claude Code
// CLI subprocess. By default that CLI does non-essential network work on startup
// (refreshing plugin marketplaces, auto-updating from GitHub) which can stall for
// minutes on some networks. We need none of it for one-shot JSON calls, so disable
// it. Setting these on process.env (not options.env) means the spawned CLI inherits
// them without us rebuilding its whole environment; subscription auth is unaffected.
// `??=` lets an explicit override from the user's own environment still win.
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1';
process.env.DISABLE_AUTOUPDATER ??= '1';

// The SDK is loaded LAZILY (on first request), never at module top-level, and the
// import is wrapped in a timeout. It's a heavy module that spawns a CLI; deferring
// it keeps server boot instant, and a misbehaving load fails one request instead of
// silently taking down the whole backend. `type` is erased at runtime, so this
// keeps `query`'s types WITHOUT triggering the real import.
type QueryFn = (typeof import('@anthropic-ai/claude-agent-sdk'))['query'];
let cachedQuery: QueryFn | null = null;

/** Reject `p` if it hasn't settled within `ms`, turning a hang into a clear error. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Load (once) and cache the SDK's `query`. */
async function getQuery(): Promise<QueryFn> {
  if (cachedQuery) return cachedQuery;
  const mod = await withTimeout(
    import('@anthropic-ai/claude-agent-sdk'),
    20_000,
    'Loading the Claude Agent SDK',
  );
  cachedQuery = mod.query;
  return cachedQuery;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'prompts', 'curation-rules.md');

// The spawned Claude CLI scribbles working files (sessions, todos, etc.) into its
// cwd. If that cwd were inside the project, the dev file-watcher would see those
// writes and restart the server mid-request, dropping the call (ECONNRESET). Point
// the CLI at a scratch dir OUTSIDE the project. A neutral cwd is also correct on its
// own: these are one-shot JSON calls that must NOT pick up the repo's own CLAUDE.md.
const CLAUDE_CWD = path.join(os.tmpdir(), 'tastetrainer-claude-cwd');
let claudeCwdReady = false;
async function ensureClaudeCwd(): Promise<string> {
  if (!claudeCwdReady) {
    await fs.mkdir(CLAUDE_CWD, { recursive: true });
    claudeCwdReady = true;
  }
  return CLAUDE_CWD;
}

/** Loaded fresh each call so edits to the rules file take effect without a restart. */
async function loadRules(): Promise<string> {
  return fs.readFile(RULES_PATH, 'utf8');
}

/** Pull a JSON value out of a model response, tolerating ```json fences / prose. */
function extractJson(text: string): any {
  const trimmed = text.trim();
  // Strip a leading/trailing code fence if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Fall back to the first balanced { … } or [ … ] span.
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

/** A human-readable progress line, surfaced to the UI as the call runs. */
export type ProgressFn = (line: string) => void;

interface RunOpts {
  onProgress?: ProgressFn;
  /**
   * Report live progress by counting completed objects in the streaming JSON.
   * `key` is the JSON field that appears once per object (e.g. "name"); `total`
   * (if known) drives an "X of N" line, otherwise we show "Found X …".
   */
  count?: { key: string; total?: number; noun: string };
}

/** One-shot prompt -> parsed JSON. No tools, single turn. */
async function runJson(system: string, prompt: string, opts: RunOpts = {}): Promise<any> {
  const { onProgress, count } = opts;
  onProgress?.('Reaching Claude…');
  const query = await getQuery();
  const cwd = await ensureClaudeCwd();

  // Each query() spawns a Claude Code CLI subprocess. The timeout below only RACES
  // the call — on its own it does NOT stop the spawned CLI, so a stuck/abandoned
  // query would leave an orphaned child running. Orphans pile up across attempts,
  // saturate the machine, and can wedge the server. The abortController lets us
  // actually tear the subprocess down; we abort it in `finally` (a no-op once the
  // query has finished cleanly, a real kill on timeout/error).
  const controller = new AbortController();

  const consume = async (): Promise<string> => {
    let result = '';
    let partial = '';
    let lastCount = -1;
    for await (const message of query({
      prompt,
      options: {
        model: CLAUDE_MODEL,
        systemPrompt: system,
        maxTurns: 1,
        allowedTools: [],
        // Stream partial output so we can show live progress instead of a blackbox.
        includePartialMessages: true,
        cwd,
        abortController: controller,
      },
    })) {
      if (message.type === 'stream_event' && count && onProgress) {
        // Accumulate streamed text and count completed objects (one `"key":` each)
        // so the UI can show "3 of 12 items" as Claude writes them.
        const ev = (message as any).event;
        if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
          partial += ev.delta.text as string;
          const n = (partial.match(new RegExp(`"${count.key}"\\s*:`, 'g')) || []).length;
          if (n > 0 && n !== lastCount) {
            lastCount = n;
            const shown = count.total ? Math.min(n, count.total) : n;
            // Singularise the noun at 1 ("1 theme", not "1 themes").
            const noun = shown === 1 ? count.noun.replace(/s$/, '') : count.noun;
            onProgress(
              count.total
                ? `Researching… ${shown} of ${count.total} ${noun}`
                : `Found ${shown} ${noun}…`,
            );
          }
        }
      } else if (message.type === 'result') {
        // The result message carries the final text in `.result` on success.
        result = (message as any).result ?? '';
        if ((message as any).subtype && (message as any).subtype !== 'success') {
          throw new Error(`Claude returned: ${(message as any).subtype}`);
        }
      }
    }
    if (!result) throw new Error('Empty response from Claude.');
    return result;
  };

  try {
    onProgress?.('Claude is researching the field…');
    // A healthy call takes ~15–25s; the cap turns a stuck call into a clear error.
    const result = await withTimeout(consume(), 90_000, 'Claude query');
    onProgress?.('Composing results…');
    return extractJson(result);
  } finally {
    controller.abort();
  }
}

const JSON_ONLY = 'Respond with valid JSON only — no markdown, no code fences, no prose.';

/**
 * Step 2 of the curate flow: propose the canonical subtopics for a new macro topic,
 * so the dataset is initialised with a sound structure before any items are added.
 */
export async function proposeSubtopics(
  topic: string,
  description: string,
  onProgress?: ProgressFn,
): Promise<{ subtopics: Subtopic[]; suggestedCount: number }> {
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;
  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\n\nPropose the canonical SUBTOPICS for this field — its core themes/areas, the MINIMUM set of distinct categories that together cover the WHOLE field (see the subtopic-count rule). Use as few or as many as the field genuinely needs — do NOT aim for a fixed number; merge near-duplicates and split conflated themes.\n\nAlso suggest how many DEFINING ITEMS best represent this field as a whole — a single integer "suggestedCount" sized to the field's real breadth (typically 12–30; fewer for a narrow field, more for a sprawling one), enough for representative coverage without padding.\n\nReturn JSON of shape: { "subtopics": [ { "name": string, "description": string } ], "suggestedCount": number }`;
  const json = await runJson(system, prompt, { onProgress, count: { key: 'name', noun: 'themes' } });
  const subtopics = (json.subtopics ?? []) as Subtopic[];
  // Trust but clamp the model's suggestion to the same 1–50 bound the UI/API enforce.
  const raw = Number(json.suggestedCount);
  const suggestedCount = Number.isFinite(raw) ? Math.max(1, Math.min(50, Math.round(raw))) : 12;
  return { subtopics, suggestedCount };
}

/**
 * Generate proposed items across the field's axes. When `existingItems` is provided
 * (expansion), avoid duplicates and prefer under-represented areas.
 */
export async function generateItems(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  count: number;
  existingItems?: Item[];
}, onProgress?: ProgressFn): Promise<ProposedItem[]> {
  const { topic, description, subtopics, count, existingItems = [] } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const subtopicList = subtopics
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');

  const existingBlock = existingItems.length
    ? `\n\nThese items already exist — do NOT repeat them, and prefer filling areas they under-cover:\n${existingItems
        .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}]`)
        .join('\n')}`
    : '';

  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\n\nCanonical subtopics (each item's "subtopic" MUST be exactly one of these names):\n${subtopicList}\n\nPropose ${count} defining items for this field. Spread them across the field's brands/makers, movements, eras and regions (breadth first), countering popularity bias.${existingBlock}\n\nFill EVERY field. Return JSON of shape:\n{ "items": [ { "name": string, "description": string, "year": number|null, "brand": string, "creator": string, "definingFact": string, "subtopic": string, "wikipediaTitle": string } ] }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'name', total: count, noun: 'items' },
  });
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  return items.map((it) => ({ ...it, image: '' }));
}

/**
 * "What's missing?" — a breadth-first sweep that reports thin/missing axes so the
 * user can target the next expansion (3-curation.md). Also suggests how many items
 * to add to meaningfully close the gaps, so the "add more" step can pre-fill a count
 * the same way the curate flow does.
 */
export async function findGaps(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  items: Item[];
}, onProgress?: ProgressFn): Promise<{ gaps: CoverageGap[]; suggestedCount: number }> {
  const { topic, description, subtopics, items } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const inventory = items
    .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}, ${i.year ?? '?'}]`)
    .join('\n');

  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\nSubtopics: ${subtopics
    .map((s) => s.name)
    .join(', ')}\n\nCurrent items (${items.length}):\n${inventory || '(none yet)'}\n\nDo a breadth-first sweep of the WHOLE field and report what is thin or missing — brands/makers, movements, eras, regions, or subtopics that a representative set of this field should include but this set under-covers. Be concrete.\n\nAlso suggest how many NEW items it would take to meaningfully close these gaps — a single integer "suggestedCount" sized to the breadth of what's missing (enough for representative coverage of the gaps without padding; 0 if coverage is already good).\n\nReturn JSON of shape: { "gaps": [ { "axis": string, "detail": string } ], "suggestedCount": number }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'axis', noun: 'gaps' },
  });
  const gaps = (json.gaps ?? []) as CoverageGap[];
  // Clamp to the same 1–50 bound the UI/API enforce; fall back to a sensible default
  // when the model omits or fumbles the number (more gaps => suggest a touch more).
  const raw = Number(json.suggestedCount);
  const fallback = Math.max(1, Math.min(20, gaps.length || 8));
  const suggestedCount = Number.isFinite(raw)
    ? Math.max(1, Math.min(50, Math.round(raw)))
    : fallback;
  return { gaps, suggestedCount };
}

/**
 * Research NEW items to close the reported gaps, taking the user's own feedback into
 * account. Feedback is treated as a hypothesis to weigh against the curation rules and
 * the field's objective reality — NOT an order: genuinely-defining requests get
 * included; requests that wouldn't improve objective coverage are left out with a
 * clear reason. The returned `note` explains how both the gaps and the feedback were
 * handled, so the user sees either why their request was added or why it wasn't.
 */
export async function fillGaps(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  existingItems: Item[];
  gaps: CoverageGap[];
  count: number;
  feedback: string;
}, onProgress?: ProgressFn): Promise<{ items: ProposedItem[]; note: string }> {
  const { topic, description, subtopics, existingItems, gaps, count, feedback } = args;
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

  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\n\nCanonical subtopics (each item's "subtopic" MUST be exactly one of these names):\n${subtopicList}\n\nItems already in the set — do NOT repeat these:\n${existingBlock}\n\nReported coverage gaps to close (breadth first):\n${gapBlock}${feedbackBlock}\n\nPropose ${count} NEW defining items that best close these gaps and widen the field's coverage, countering popularity bias. Fill EVERY field.\n\nReturn JSON of shape:\n{ "items": [ { "name": string, "description": string, "year": number|null, "brand": string, "creator": string, "definingFact": string, "subtopic": string, "wikipediaTitle": string } ], "note": string }\n\nThe "note" is a short, plain-language explanation (2–5 sentences) of how you handled the gaps and the user's feedback: what you added and why, and for any user request you did NOT include, a clear reason why.`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'name', total: count, noun: 'items' },
  });
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  const note = typeof json.note === 'string' ? json.note : '';
  return { items: items.map((it) => ({ ...it, image: '' })), note };
}
