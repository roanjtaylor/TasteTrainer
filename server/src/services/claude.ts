// Calls Claude via the HF Space proxy (https://roanjtaylor-iphone-claude.hf.space),
// which uses the owner's Claude subscription — no API credits consumed.
// The HF Space streams SSE delta events; this file accumulates them, tracks live
// progress (counting completed JSON objects in the stream), and extracts the final JSON.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MODEL, HF_BASE_URL, HF_APP_SECRET } from '../config.ts';
import type { CoverageGap, EraGroup, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

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
  onProgress?.('Reaching Claude…');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

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
      throw new Error(`HF Space error ${res.status}: ${text.slice(0, 200)}`);
    }

    onProgress?.('Claude is researching the field…');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let lastCount = -1;
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
              const shown = count.total ? Math.min(n, count.total) : n;
              const noun = shown === 1 ? count.noun.replace(/s$/, '') : count.noun;
              onProgress(
                count.total
                  ? `Researching… ${shown} of ${count.total} ${noun}`
                  : `Found ${shown} ${noun}…`,
              );
            }
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
  } finally {
    clearTimeout(timer);
  }
}

const JSON_ONLY = 'Respond with valid JSON only — no markdown, no code fences, no prose.';

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
  const raw = Number(json.suggestedCount);
  const suggestedCount = Number.isFinite(raw) ? Math.max(1, Math.min(50, Math.round(raw))) : 12;
  return { subtopics, suggestedCount };
}

export async function proposePeriods(args: {
  topic: string;
  description: string;
  items: Item[];
}, onProgress?: ProgressFn): Promise<EraGroup[]> {
  const { topic, description, items } = args;
  const rules = await loadRules();
  const system = `You are the curation engine for TasteTrainer.\n\n${rules}\n\n${JSON_ONLY}`;

  const years = items.map((i) => i.year).filter((y): y is number => typeof y === 'number');
  const minYear = years.length ? Math.min(...years) : 1900;
  const maxYear = years.length ? Math.max(...years) : new Date().getFullYear();

  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\n\nThe work in this field spans roughly ${minYear}–${maxYear}.\n\nPropose the canonical ERA-PERIODS for this field — the named time divisions a knowledgeable person uses to structure its history (e.g. art movements for paintings, design eras for product fields). Use as few or as many as the field genuinely needs; do NOT aim for a fixed number.\n\nRules:\n- Periods must be CONTIGUOUS and NON-OVERLAPPING (each period's "start" equals the previous period's "end").\n- Together they must cover the whole span ${minYear}–${maxYear} (first period's start <= ${minYear}, last period's end > ${maxYear}).\n- "start" is inclusive, "end" is exclusive, both whole years.\n- Order from earliest to latest.\n\nReturn JSON of shape: { "eraGroups": [ { "label": string, "start": number, "end": number } ] }`;

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

  const subtopicList = subtopics.map((s) => `- ${s.name}: ${s.description}`).join('\n');
  const existingBlock = existingItems.length
    ? `\n\nThese items already exist — do NOT repeat them, and prefer filling areas they under-cover:\n${existingItems
        .map((i) => `- ${i.name}${i.brand ? ` (${i.brand})` : ''} [${i.subtopic}]`)
        .join('\n')}`
    : '';

  const prompt = `Macro topic: "${topic}"\nField description: "${description}"\n\nCanonical subtopics (each item's "subtopic" MUST be exactly one of these names):\n${subtopicList}\n\nPropose ${count} defining items for this field. Spread them across the field's brands/makers, movements, eras and regions (breadth first), countering popularity bias.${existingBlock}\n\nFill EVERY field. Return JSON of shape:\n{ "items": [ { "name": string, "description": string, "year": number|null, "brand": string, "creator": string, "definingFact": string, "subtopic": string, "wikipediaTitle": string } ] }`;

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
  const raw = Number(json.suggestedCount);
  const fallback = Math.max(1, Math.min(20, gaps.length || 8));
  const suggestedCount = Number.isFinite(raw)
    ? Math.max(1, Math.min(50, Math.round(raw)))
    : fallback;
  return { gaps, suggestedCount };
}

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
    timeoutMs: 120_000 + count * 7_000,
  });
  const items = (json.items ?? []) as Omit<ProposedItem, 'image'>[];
  const note = typeof json.note === 'string' ? json.note : '';
  return { items: items.map((it) => ({ ...it, image: '' })), note };
}
