// Talks to Claude via the Claude Agent SDK, using whatever credentials the local
// environment already has (the same login Claude Code uses, or ANTHROPIC_API_KEY).
// No key is hardcoded here. See README for auth notes.
import { query } from '@anthropic-ai/claude-agent-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_MODEL } from '../config.ts';
import type { CoverageGap, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'prompts', 'curation-rules.md');

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
  let result = '';
  for await (const message of query({
    prompt,
    options: {
      model: CLAUDE_MODEL,
      systemPrompt: system,
      maxTurns: 1,
      allowedTools: [],
    },
  })) {
    if (message.type === 'result') {
      // The result message carries the final text in `.result` on success.
      result = (message as any).result ?? '';
      if ((message as any).subtype && (message as any).subtype !== 'success') {
        throw new Error(`Claude returned: ${(message as any).subtype}`);
      }
    }
  }
  if (!result) throw new Error('Empty response from Claude.');
  return extractJson(result);
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
