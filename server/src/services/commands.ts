import type { ChatCommand } from '../../../shared/chat.ts';
import { COMMAND_NAME, listCommandPrompts } from './promptStore.ts';

// Saved prompts — the dock's slash commands (manual.md). Exactly like Claude Code's
// .claude/commands: a file per command in prompts/commands (`gaps.md` → `/gaps`), a
// `description:` line in a frontmatter block for the picker, the body for Claude, and
// `$ARGUMENTS` for whatever the user typed after the name (with no placeholder, the
// extra words are appended as a final line). Where they live, and how an edit made
// through the chat overrides the file, is services/promptStore.ts.
//
// They are prompts, nothing more: a command does nothing a typed message couldn't. The
// point is to keep a good, thorough ask on file instead of retyping it.

export async function listCommands(): Promise<ChatCommand[]> {
  return (await listCommandPrompts()).map(({ name, description }) => ({ name, description }));
}

/**
 * If the message starts with a saved command (`/update`, `/create 15 more`), the prompt
 * Claude should be sent instead; otherwise null and the text goes as typed. An unknown
 * `/word` is left alone — it might just be a path or a fraction.
 */
export async function expandCommand(text: string): Promise<string | null> {
  const m = text.trim().match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!m || !COMMAND_NAME.test(m[1].toLowerCase())) return null;
  const cmd = (await listCommandPrompts()).find((c) => c.name === m[1].toLowerCase());
  if (!cmd) return null;
  const args = (m[2] ?? '').trim();
  if (cmd.body.includes('$ARGUMENTS')) return cmd.body.replaceAll('$ARGUMENTS', args);
  return args ? `${cmd.body}\n\n${args}` : cmd.body;
}
