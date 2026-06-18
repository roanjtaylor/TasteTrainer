// Talks to Claude via the Claude Agent SDK, using whatever credentials the local
// environment already has (the same login Claude Code uses, or ANTHROPIC_API_KEY).
// No key is hardcoded here. See README for auth notes.
import fs from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MODEL } from '../config.ts';
import type { CoverageGap, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

// The Agent SDK doesn't call an API directly — it spawns a full Claude Code CLI
// session. By default that session does non-essential network/git work on startup:
// refreshing plugin marketplaces and auto-updating plugins from GitHub. On some
// networks/machines that stalls for minutes (the real cause of the "stuck on
// loading the SDK" hang). We need none of it for one-shot JSON calls, so disable
// it. Setting these on process.env (rather than options.env) means the spawned CLI
// inherits them without us having to reconstruct its whole environment; subscription
// auth (the OAuth token in ~/.claude/.credentials.json) is unaffected. `??=` lets an
// explicit override from the user's own environment still win.
process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC ??= '1';
process.env.DISABLE_AUTOUPDATER ??= '1';

// Synchronous, unbuffered phase logger. console.log is block-buffered when stdout
// is a pipe (e.g. under `concurrently`), which hides exactly the lines you need
// when diagnosing a hang. Writing straight to a file with appendFileSync sidesteps
// that. Gated by DEBUG_CLAUDE_SDK so it's off by default. The file is written to
// the OS temp dir (NOT the project) so the dev watcher doesn't restart on it.
const DBG_PATH = path.join(os.tmpdir(), 'tastetrainer-claude-debug.log');
function dbg(msg: string): void {
  if (!process.env.DEBUG_CLAUDE_SDK) return;
  try {
    appendFileSync(DBG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    /* never let logging break a request */
  }
}

// The Claude Agent SDK is loaded LAZILY (on first use), NOT at module top-level.
// Importing it during startup hung the whole server before it could bind its port
// — boot never got past "importing ./routes/curation.ts", and because it hung
// (rather than threw) there was no stack trace. Deferring it lets the server boot
// instantly; a misbehaving SDK now fails one request (with a timeout) instead of
// taking down the entire backend. The `type` reference is erased at runtime, so it
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

/** Load (once) and cache the SDK's `query`, guarded by a timeout + debug logging. */
async function getQuery(): Promise<QueryFn> {
  if (cachedQuery) return cachedQuery;
  console.log('[claude] loading @anthropic-ai/claude-agent-sdk …');
  dbg('getQuery: BEFORE import()');
  const startedAt = Date.now();
  const mod = await withTimeout(
    import('@anthropic-ai/claude-agent-sdk'),
    20_000,
    'Loading the Claude Agent SDK',
  );
  dbg(`getQuery: AFTER import() (${Date.now() - startedAt}ms)`);
  console.log(`[claude] SDK module loaded in ${Date.now() - startedAt}ms`);
  cachedQuery = mod.query;
  return cachedQuery;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'prompts', 'curation-rules.md');

// The spawned Claude CLI scribbles working files (sessions, todos, etc.) into its
// cwd. If that cwd is inside the project, the dev file-watcher sees those writes
// and restarts the server mid-request, dropping the call (ECONNRESET). Point the
// CLI at a scratch dir OUTSIDE the project so its writes never trip the watcher.
// A neutral cwd is also correct on its own: these are one-shot JSON calls that
// must NOT pick up the repo's own CLAUDE.md / project context.
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

/** One-shot prompt -> parsed JSON. No tools, single turn. */
async function runJson(system: string, prompt: string): Promise<any> {
  const startedAt = Date.now();
  dbg('runJson: BEFORE getQuery()');
  const query = await getQuery();
  const cwd = await ensureClaudeCwd();
  dbg('runJson: AFTER getQuery(); BEFORE query() iteration');
  console.log(`[claude] query start — model ${CLAUDE_MODEL}, prompt ${prompt.length} chars`);

  // Each query() spawns a full Claude Code CLI subprocess. The timeout below only
  // RACES the call — it does not, on its own, stop the spawned CLI. Without an
  // abortController, a slow or stuck query leaves an orphaned CLI child running:
  // they pile up across attempts (re-clicks, retries), saturate the machine, and
  // eventually wedge the server so that even later timers stop firing — the real
  // cause of "stuck on loading the SDK forever". Passing this controller lets us
  // actually tear the subprocess down. Aborting after a clean finish is a no-op.
  const controller = new AbortController();

  // Consume the streamed messages. A healthy call here takes ~15–25s; the timeout
  // below caps a stuck call so it fails with a clear error instead of an infinite
  // spinner. Each message type is logged so we can trace how far the SDK got —
  // auth/credential failures show up as an error message or non-success subtype.
  const consume = async (): Promise<string> => {
    let result = '';
    let sawResult = false;
    for await (const message of query({
      prompt,
      options: {
        model: CLAUDE_MODEL,
        systemPrompt: system,
        maxTurns: 1,
        allowedTools: [],
        // Run the CLI in a scratch dir outside the project (see CLAUDE_CWD) so its
        // working-file writes don't trip the dev watcher and restart the server.
        cwd,
        // Kill the spawned CLI when we abort (timeout / error) instead of leaking it.
        abortController: controller,
        // The SDK ignores the spawned CLI's stderr by default. Opt in with
        // DEBUG_CLAUDE_SDK=1 to surface exactly what that CLI is doing — the only
        // way to see auth prompts / startup stalls happening inside the SDK.
        stderr: process.env.DEBUG_CLAUDE_SDK
          ? (s: string) => console.error('[claude/cli]', s.trimEnd())
          : undefined,
      },
    })) {
      dbg(`runJson: message ${message.type}`);
      console.log(`[claude] message: ${message.type}`);
      if (message.type === 'result') {
        sawResult = true;
        // The result message carries the final text in `.result` on success.
        result = (message as any).result ?? '';
        if ((message as any).subtype && (message as any).subtype !== 'success') {
          throw new Error(`Claude returned: ${(message as any).subtype}`);
        }
      }
    }
    console.log(
      `[claude] query done in ${Date.now() - startedAt}ms — sawResult=${sawResult}, ${result.length} chars`,
    );
    if (!result) throw new Error('Empty response from Claude.');
    return result;
  };

  try {
    const result = await withTimeout(consume(), 90_000, 'Claude query');
    return extractJson(result);
  } catch (err) {
    console.error(`[claude] query FAILED after ${Date.now() - startedAt}ms:`, err);
    throw err;
  } finally {
    // Tear down the CLI subprocess. On a clean finish it has already exited and
    // this is a harmless no-op; on timeout/error it stops an orphaned child.
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
): Promise<Subtopic[]> {
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;
  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\n\nPropose the canonical SUBTOPICS for this field — the tidy, fixed set of categories items will be sorted into. Cover the real breadth of the field (see the coverage and anti-bias rules), typically 5–9 subtopics.\n\nReturn JSON of shape: { "subtopics": [ { "name": string, "description": string } ] }`;
  const json = await runJson(system, prompt);
  return (json.subtopics ?? []) as Subtopic[];
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
}): Promise<ProposedItem[]> {
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

  const json = await runJson(system, prompt);
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  return items.map((it) => ({ ...it, image: '' }));
}

/**
 * "What's missing?" — a breadth-first sweep that reports thin/missing axes so the
 * user can target the next expansion (3-curation.md).
 */
export async function findGaps(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  items: Item[];
}): Promise<CoverageGap[]> {
  const { topic, description, subtopics, items } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const inventory = items
    .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}, ${i.year ?? '?'}]`)
    .join('\n');

  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\nSubtopics: ${subtopics
    .map((s) => s.name)
    .join(', ')}\n\nCurrent items (${items.length}):\n${inventory || '(none yet)'}\n\nDo a breadth-first sweep of the WHOLE field and report what is thin or missing — brands/makers, movements, eras, regions, or subtopics that a representative set of this field should include but this set under-covers. Be concrete.\n\nReturn JSON of shape: { "gaps": [ { "axis": string, "detail": string } ] }`;

  const json = await runJson(system, prompt);
  return (json.gaps ?? []) as CoverageGap[];
}
