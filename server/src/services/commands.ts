import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatCommand } from '../../../shared/chat.ts';

// Saved prompts — the dock's slash commands (manual.md). One Markdown file per command
// in prompts/commands, exactly like Claude Code's .claude/commands: the file name is
// the command (`gaps.md` → `/gaps`), a `description:` line in a frontmatter block is
// what the picker shows, and the body is the prompt Claude is sent. `$ARGUMENTS` in the
// body is replaced with whatever the user typed after the command name; with no
// placeholder, the extra words are appended as a final line.
//
// They are prompts, nothing more: a command does nothing a typed message couldn't. The
// point is to keep a good, thorough ask on file instead of retyping it — the same reason
// the curation rulebook is a file (services/curationRules.ts). Add a file, and it's in
// the picker on the next message; no code change, no restart.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = path.join(__dirname, '..', 'prompts', 'commands');

interface LoadedCommand extends ChatCommand {
  body: string;
}

function parse(name: string, raw: string): LoadedCommand {
  let description = '';
  let body = raw;
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    body = raw.slice(fm[0].length);
    const line = fm[1].split(/\r?\n/).find((l) => /^description\s*:/i.test(l));
    if (line) description = line.replace(/^description\s*:/i, '').trim().replace(/^["']|["']$/g, '');
  }
  return { name, description, body: body.trim() };
}

/** Every command on disk, read fresh each time — edits take effect on the next message. */
export async function loadCommands(): Promise<LoadedCommand[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(COMMANDS_DIR);
  } catch {
    return [];
  }
  const out: LoadedCommand[] = [];
  for (const file of files.filter((f) => f.endsWith('.md')).sort()) {
    const name = file.slice(0, -3).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) continue;
    out.push(parse(name, await fs.readFile(path.join(COMMANDS_DIR, file), 'utf8')));
  }
  return out;
}

export async function listCommands(): Promise<ChatCommand[]> {
  return (await loadCommands()).map(({ name, description }) => ({ name, description }));
}

/**
 * If the message starts with a saved command (`/gaps`, `/expand 15 more`), the prompt
 * Claude should be sent instead; otherwise null and the text goes as typed. An unknown
 * `/word` is left alone — it might just be a path or a fraction.
 */
export async function expandCommand(text: string): Promise<string | null> {
  const m = text.trim().match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const cmd = (await loadCommands()).find((c) => c.name === m[1].toLowerCase());
  if (!cmd) return null;
  const args = (m[2] ?? '').trim();
  if (cmd.body.includes('$ARGUMENTS')) return cmd.body.replaceAll('$ARGUMENTS', args);
  return args ? `${cmd.body}\n\n${args}` : cmd.body;
}
