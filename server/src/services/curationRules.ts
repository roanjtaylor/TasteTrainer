import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The user's own curation rulebook (prompts/curation-rules.md) — what belongs in a
// field, breadth over popularity, how a world is mapped. Claude reads it through the
// agent's `get_curation_rules` tool (services/agentTools.ts) rather than it being
// pasted into a fixed system prompt, so editing the file is editing the standard.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_PATH = path.join(__dirname, '..', 'prompts', 'curation-rules.md');

/** Loaded fresh each call so edits to the rules file take effect without a restart. */
export async function loadRules(): Promise<string> {
  return fs.readFile(RULES_PATH, 'utf8');
}
