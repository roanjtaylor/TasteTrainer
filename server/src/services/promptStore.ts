// The prompts Claude works from, and where each one currently lives.
//
// Two kinds: the curation RULEBOOK (prompts/curation-rules.md — what belongs in a field,
// breadth over popularity, how a world is mapped) and the saved COMMANDS (prompts/
// commands/*.md — the dock's `/` prompts). Both ship as files in the server image. Both
// can also be overridden by a row in taste_prompts (migration 012), and a row wins.
//
// The row exists so the standard can change without a deploy — and so Claude can
// propose a change to its own rules the way it proposes a change to the data
// (agentTools.ts's propose_update_rules / propose_update_command → a `prompt.update`
// op → accepted → savePromptOverride). Undoing the first accepted edit deletes the row,
// and the shipped file is current again. Nothing here caches: a prompt is read at the
// moment it is used, so an accepted edit applies to the very next message.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPromptOverride, listPromptOverrides } from '../storage.ts';
import type { PromptKind, PromptText } from '../../../shared/chat.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'prompts', 'curation-rules.md');
const COMMANDS_DIR = path.join(__dirname, '..', 'prompts', 'commands');

export const RULES_NAME = 'rules';
export const COMMAND_NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface Prompt extends PromptText {
  name: string;
  kind: PromptKind;
  /** True when a taste_prompts row is what's in force (rather than the shipped file). */
  stored: boolean;
}

// ---- Files ----

/** A command file: an optional frontmatter block whose `description:` line is what the
 *  picker shows, then the body Claude is sent. */
function parseCommandFile(raw: string): PromptText {
  let description = '';
  let body = raw;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    const line = fm[1].split(/\r?\n/).find((l) => /^description\s*:/i.test(l));
    if (line) description = line.replace(/^description\s*:/i, '').trim().replace(/^["']|["']$/g, '');
  }
  return { description, body: body.trim() };
}

async function fileCommands(): Promise<Map<string, PromptText>> {
  const out = new Map<string, PromptText>();
  let files: string[] = [];
  try {
    files = await fs.readdir(COMMANDS_DIR);
  } catch {
    return out;
  }
  for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
    const name = file.slice(0, -3).toLowerCase();
    if (!COMMAND_NAME.test(name)) continue;
    out.set(name, parseCommandFile(await fs.readFile(path.join(COMMANDS_DIR, file), 'utf8')));
  }
  return out;
}

// ---- Reading ----

/** The rulebook as it currently reads. */
export async function readRules(): Promise<Prompt> {
  const row = await getPromptOverride(RULES_NAME);
  if (row) return { name: RULES_NAME, kind: 'rules', description: '', body: row.body, stored: true };
  return { name: RULES_NAME, kind: 'rules', description: '', body: await fs.readFile(RULES_PATH, 'utf8'), stored: false };
}

/** Kept for callers that only want the text (agentTools.ts's get_curation_rules). */
export const loadRules = async (): Promise<string> => (await readRules()).body;

/** Every command, files and overrides merged: an override replaces the file of the
 *  same name, and an override with no file is a command added through the chat. */
export async function listCommandPrompts(): Promise<Prompt[]> {
  const [files, rows] = await Promise.all([fileCommands(), listPromptOverrides()]);
  const out = new Map<string, Prompt>();
  for (const [name, text] of files) out.set(name, { name, kind: 'command', ...text, stored: false });
  for (const row of rows) {
    if (row.kind !== 'command' || !COMMAND_NAME.test(row.name)) continue;
    out.set(row.name, { name: row.name, kind: 'command', description: row.description, body: row.body, stored: true });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** One prompt by name — `rules`, or a command name. Null for a command that doesn't exist. */
export async function readPrompt(name: string): Promise<Prompt | null> {
  if (name === RULES_NAME) return readRules();
  return (await listCommandPrompts()).find((c) => c.name === name) ?? null;
}
