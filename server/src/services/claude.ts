// Calls Claude via the HF Space proxy (https://roanjtaylor-claudesubscription.hf.space),
// which uses the owner's Claude subscription — no API credits consumed.
// The HF Space streams SSE delta events; this file accumulates them, tracks live
// progress (counting completed JSON objects in the stream), and extracts the final JSON.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, fetch as undiciFetch } from 'undici';
import { CLAUDE_MODEL, CLAUDE_TIMEOUT_MS, HF_BASE_URL, HF_APP_SECRET } from '../config.ts';

/**
 * Node's built-in `fetch` (undici) has ITS OWN idle limits underneath any AbortSignal
 * we pass: `headersTimeout` and `bodyTimeout` both default to 300 000 ms. Either one
 * — no response headers for 5 min, or no body chunk for 5 min — kills the connection
 * with a bare `TypeError: terminated`. That is exactly what a long-thinking research
 * call looks like from here (the Space forwards nothing until the model starts
 * emitting), so a run that had five silent minutes died at 300 s regardless of the
 * hour-long CLAUDE_TIMEOUT_MS. This dispatcher lifts both to that same cap; the
 * AbortController in `runJsonOnce` remains the one real deadline. Used with the
 * `undici` package's own `fetch` (not the global one) so the Agent and the fetch are
 * guaranteed the same undici version — Node's bundled copy and the package can drift.
 */
const claudeDispatcher = new Agent({
  headersTimeout: CLAUDE_TIMEOUT_MS,
  bodyTimeout: CLAUDE_TIMEOUT_MS,
});
import type {
  Domain,
  Item,
  ProposedItem,
  Subtopic,
} from '../../../shared/types.ts';

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
export async function loadRules(): Promise<string> {
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
  /** Hard cap on the whole call in ms. Defaults to CLAUDE_TIMEOUT_MS (an hour) — a
   *  stuck-request backstop, not a per-call budget. Callers used to pass their own
   *  minute-scale budgets here; those were sized for the old proxy limits and cut
   *  legitimately long research runs short, so none do any more. */
  timeoutMs?: number;
}

/** "90s" below a minute, "5m" / "5m30s" at or above — the timeout error used to always
 *  say "Ns", which read fine at 120s but turns into an ugly "600s" now that research calls
 *  have multi-minute budgets. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}

/** Marks a failure as "Claude's own output wasn't valid JSON" specifically — as
 *  opposed to a timeout, a network/auth error, or the model reporting its own error —
 *  so `runJson` knows retrying with an identical prompt is actually worth trying. */
class JsonParseError extends Error {}

/**
 * One-shot prompt → parsed JSON via the HF Space /api/chat SSE endpoint.
 *
 * Retries ONCE, only when Claude's response itself failed to parse as JSON (despite
 * `JSON_ONLY` and the model normally complying) — that is model flakiness a re-ask
 * usually fixes, not a bug worth surfacing as a raw `JSON.parse` error ("Expected ','
 * or '}' after property value…") for the user to puzzle over. A timeout, a network
 * failure, or the model reporting its own error are not retried here — those aren't
 * fixed by asking the exact same question again.
 */
async function runJson(system: string, prompt: string, opts: RunOpts): Promise<any> {
  try {
    return await runJsonOnce(system, prompt, opts);
  } catch (err) {
    if (!(err instanceof JsonParseError)) throw err;
    opts.onProgress?.("Claude's answer wasn't valid JSON — retrying once…");
    try {
      return await runJsonOnce(system, prompt, opts);
    } catch (retryErr: any) {
      if (retryErr instanceof JsonParseError) {
        throw new Error(
          `Claude's response wasn't valid JSON, even after retrying once: ${retryErr.message}`,
        );
      }
      throw retryErr;
    }
  }
}

async function runJsonOnce(system: string, prompt: string, opts: RunOpts): Promise<any> {
  const { onProgress, count, timeoutMs = CLAUDE_TIMEOUT_MS } = opts;

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
  // Timer-driven, not delta-driven: the "Still working…" line below used to fire only
  // as text arrived, so the (often long) silent stretch before the FIRST token — the
  // model thinking, the proxy waiting on it — reported nothing at all. To a card that
  // is only reading the job row (a resumed session), that was indistinguishable from
  // a call that never started. This ticks whether or not anything is streaming.
  const heartbeat = onProgress
    ? setInterval(() => {
        if (Date.now() - lastProgressAt > 8_000) {
          lastProgressAt = Date.now();
          onProgress(`Still working… ${Math.round((Date.now() - startedAt) / 1000)}s`);
        }
      }, 4_000)
    : undefined;

  try {
    const res = await undiciFetch(`${HF_BASE_URL}/api/chat`, {
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
      dispatcher: claudeDispatcher,
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
    try {
      return extractJson(accumulated);
    } catch (e: any) {
      throw new JsonParseError(e?.message ?? 'Could not parse JSON from model response.');
    }
  } catch (err: any) {
    if (timedOut) {
      // Report how far it got: a call that was clearly still producing work when the
      // clock ran out is a budget problem, and one that produced nothing in the same
      // time is a stuck request. Those want different responses from the user.
      const produced = lastCount > 0 ? ` It had produced ${lastCount} ${count?.noun ?? 'results'}.` : '';
      throw new Error(
        `Claude ran out of time after ${formatDuration(timeoutMs)}.${produced} ` +
          'Nothing was saved — try again, or narrow what you asked for.',
      );
    }
    // undici's word for "the connection died mid-stream" — the upstream closed it, or
    // an idle limit fired. Say that, with how far it got, instead of one bare word.
    if (err?.message === 'terminated' || err?.cause?.message === 'terminated') {
      const produced = lastCount > 0 ? ` It had produced ${lastCount} ${count?.noun ?? 'results'}.` : '';
      throw new Error(
        `The connection to the Claude proxy dropped after ${formatDuration(Date.now() - startedAt)}, ` +
          `before the response finished.${produced} Nothing was saved — try again.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (heartbeat) clearInterval(heartbeat);
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
  if (domain !== 'digital') {
    return [
      '"subtopic": string',
      '"wikipediaTitle": string — the most likely English Wikipedia article title for this work, or "" if there plainly is none',
      '"imageQuery": string — a precise phrase to find a picture of THIS EXACT item in an image search, naming the specific model/reference/generation AND the year, not just the brand or product line. A bare brand+name (e.g. "Rolex Submariner", "Ford Mustang") returns whatever the current/most-photographed version is, which is usually wrong for an older or specific item. Write e.g. "Rolex Submariner ref. 5513 1965", "Ford Mustang 1965 fastback", "Eames Lounge Chair 670 rosewood 1956" — brand, the specific model/reference/trim, and the year or generation, every time one is knowable',
    ].join(', ');
  }
  return [
    '"subtopic": string',
    '"imageKind": one of "archived-site" | "live-site" | "software-ui" | "artifact" — how a picture of this can actually be obtained:',
    '    "archived-site" = a WEBSITE whose PAST design you are showing (captured from the web archive near "year")',
    '    "live-site"     = a WEBSITE whose PRESENT design you are showing',
    '    "software-ui"   = software that is NOT a website: an operating system shell, desktop app, terminal, or anything pre-web',
    '    "artifact"      = a graphic work: an icon set, typeface, logo, poster, or a still from a motion piece',
    '"url": string — the canonical site address (e.g. "https://stripe.com"), ONLY for "archived-site"/"live-site". Use "" for the other two. NEVER a Wikipedia url',
    '"wikipediaTitle": string — the most likely English Wikipedia article title for this work, or "" if there plainly is none. Give this for EVERY item, including websites; it is the fallback when a capture fails',
    '"imageQuery": string — a precise phrase to find a picture of THIS EXACT design/snapshot in an image archive, naming the specific version AND the year, e.g. "Mac OS System 7 Finder desktop screenshot 1991" or "Susan Kare original Macintosh icons 1984", not just "System 7" or "Macintosh icons". Write it for a search engine, not as a title — vague terms return whichever version is most photographed today, not the specific one this item represents',
    '("year" is the year THIS SPECIFIC design/snapshot represents, which may be a past redesign, not necessarily today\'s look)',
  ].join(', ');
}

export async function generateItems(args: {
  topic: string;
  description: string;
  subtopics: Subtopic[];
  count: number;
  domain: Domain;
  existingItems?: Item[];
}, onProgress?: ProgressFn): Promise<ProposedItem[]> {
  const { topic, description, subtopics, count, domain, existingItems = [] } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const subtopicList = subtopics.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  const existingBlock = existingItems.length
    ? `\n\nThese items already exist — do NOT repeat them, and prefer filling areas they under-cover:\n${existingItems
        .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}]`)
        .join('\n')}`
    : '';

  const prompt = `${domainLine(domain)}\n\nMacro topic: "${topic}"\nField description: "${description}"\n\nCanonical subtopics (each item's "subtopic" MUST be exactly one of these names):\n${subtopicList}\n\nPropose ${count} defining items for this field. Spread them across the field's brands/makers, movements, eras and regions (breadth first), countering popularity bias.${existingBlock}\n\nFill EVERY field. Return JSON of shape:\n{ "items": [ { "name": string, "description": string, "year": number|null, "brand": string, "creator": string, "definingFact": string, ${itemShapeLine(domain)} } ] }`;

  const json = await runJson(system, prompt, {
    onProgress,
    count: { key: 'name', total: count, noun: 'items' },
  });
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  return items.map((it) => ({ ...it, image: '' }));
}
