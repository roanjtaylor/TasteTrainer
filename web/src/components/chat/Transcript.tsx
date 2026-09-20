import { useState } from 'react';
import type { ChatBlock, ChatMessage } from '../../../../shared/chat';
import { Markdown } from './Markdown';

// One assistant turn, drawn the way Claude Code draws it: what Claude thought, each
// thing it did (with what it was given and what came back, a click away), and what it
// said — in the order they happened, filling in live. This is the replacement for the
// single "Still working… 40s" line the curation calls show.

type ToolBlock = Extract<ChatBlock, { type: 'tool' }>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** How many array entries a half-streamed tool input holds so far — counts the key
 *  every entry has exactly once, which is what lets "Proposing 7 items…" tick up live. */
function countSoFar(block: ToolBlock, listKey: string, entryKey: string): number {
  const input = block.input as Record<string, unknown> | undefined;
  if (Array.isArray(input?.[listKey])) return (input[listKey] as unknown[]).length;
  return (block.partial?.match(new RegExp(`"${entryKey}"\\s*:`, 'g')) ?? []).length;
}

function hostOf(url: unknown): string {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return 'a page'; }
}

/** The one-line, human description of a tool call. */
function labelOf(block: ToolBlock): string {
  const input = (block.input ?? {}) as Record<string, any>;
  const ds = input.dataset ? ` ${input.dataset}` : '';
  const named = ds && !/^[0-9a-f-]{36}$/i.test(String(input.dataset)) ? ds : ' this dataset';
  switch (block.name) {
    case 'list_datasets': return `Looked at the ${input.domain ? `${input.domain} ` : ''}shelf`;
    case 'get_dataset': return `Read${named}${input.detail === 'full' ? ' in full' : ''}${input.subtopic ? ` · ${input.subtopic}` : ''}`;
    case 'get_items': return `Read ${plural(input.itemIds?.length ?? 0, 'item')} in full`;
    case 'search_items': return `Searched your items for “${input.query ?? '…'}”`;
    case 'get_world_map': return `Read the ${input.domain ?? ''} world map`;
    case 'get_curation_rules': return 'Read your curation rules';
    case 'get_pending_changes': return 'Checked what’s already staged';
    case 'propose_add_items': return `Proposing ${plural(countSoFar(block, 'items', 'name'), 'new item')}`;
    case 'propose_update_items': return `Proposing edits to ${plural(countSoFar(block, 'updates', 'itemId'), 'item')}`;
    case 'propose_remove_items': return `Proposing to remove ${plural(input.itemIds?.length ?? 0, 'item')}`;
    case 'propose_move_items': return `Proposing to move ${plural(input.itemIds?.length ?? 0, 'item')}${input.toDataset ? ` to ${input.toDataset}` : ''}`;
    case 'propose_update_dataset': return 'Proposing a change to the dataset itself';
    case 'propose_create_dataset': return `Proposing a new dataset${input.topic ? `: ${input.topic}` : ''}`;
    case 'propose_delete_dataset': return `Proposing to delete the emptied dataset${input.dataset ? ` ${input.dataset}` : ''}`;
    case 'propose_draw_map': return `Proposing ${input.redraw ? 'a redrawn' : 'a'} map of the ${input.domain ?? ''} world`;
    case 'propose_map_changes': return 'Proposing changes to the map';
    case 'withdraw_changes': return `Withdrew ${plural(input.opIds?.length ?? 0, 'staged change')}`;
    case 'WebSearch': return `Searched the web for “${input.query ?? '…'}”`;
    case 'WebFetch': return `Read ${hostOf(input.url)}`;
    default: return block.name;
  }
}

function ToolRow({ block }: { block: ToolBlock }) {
  const [open, setOpen] = useState(false);
  const proposing = block.name.startsWith('propose_');
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            !block.done ? 'animate-pulse bg-[var(--color-claude)]' : block.isError ? 'bg-red-500' : proposing ? 'bg-emerald-600' : 'bg-[var(--color-line)]'
          }`}
        />
        <span className={`min-w-0 flex-1 truncate ${!block.done ? 'text-[var(--color-ink)]' : ''}`}>
          {labelOf(block)}{!block.done && '…'}
        </span>
        <span className="shrink-0 text-[10px] opacity-60">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="custom-scroll ml-4 mt-1 max-h-56 space-y-2 overflow-auto rounded border border-[var(--color-line)] bg-[var(--color-wall-soft)] p-2 font-mono text-[11px] leading-snug">
          <div>
            <div className="mb-0.5 font-sans text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Input</div>
            <pre className="whitespace-pre-wrap break-words">{block.input !== undefined ? JSON.stringify(block.input, null, 1) : (block.partial ?? '…')}</pre>
          </div>
          {block.result !== undefined && (
            <div>
              <div className="mb-0.5 font-sans text-[10px] uppercase tracking-wide text-[var(--color-muted)]">{block.isError ? 'Refused' : 'Result'}</div>
              <pre className={`whitespace-pre-wrap break-words ${block.isError ? 'text-red-700' : ''}`}>{block.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Thinking({ text, live }: { text: string; live: boolean }) {
  const [open, setOpen] = useState(false);
  // While it's being written, show the tail — the most recent thought — so there is
  // always something moving; afterwards it collapses to a line you can reopen.
  const tail = text.trim().split('\n').filter(Boolean).slice(-2).join(' ');
  return (
    <div className="text-xs text-[var(--color-muted)]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left hover:bg-[var(--color-wall-soft)]">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? 'animate-pulse bg-[var(--color-claude)]' : 'bg-[var(--color-line)]'}`} />
        <span className="min-w-0 flex-1 truncate italic">{live && !open ? tail || 'Thinking…' : live ? 'Thinking…' : 'Thought it through'}</span>
        <span className="shrink-0 text-[10px] opacity-60">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="ml-4 mt-1 whitespace-pre-wrap border-l border-[var(--color-line)] pl-3 italic leading-relaxed">{text}</div>}
    </div>
  );
}

export function AssistantTurn({ message }: { message: ChatMessage }) {
  const live = message.status === 'running' || message.status === 'queued';
  const lastIndex = message.blocks.length - 1;
  return (
    <div className="space-y-1.5">
      {message.blocks.map((block, i) =>
        block.type === 'text' ? (
          <div key={i} className="px-1.5"><Markdown text={block.text} /></div>
        ) : block.type === 'thinking' ? (
          <Thinking key={i} text={block.text} live={live && i === lastIndex} />
        ) : (
          <ToolRow key={block.id} block={block} />
        ),
      )}

      {message.status === 'queued' && <p className="px-1.5 text-xs italic text-[var(--color-muted)]">Queued — Claude is finishing another conversation first…</p>}
      {message.status === 'running' && !message.blocks.length && (
        <p className="flex items-center gap-2 px-1.5 text-xs italic text-[var(--color-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-claude)]" />Reaching Claude…
        </p>
      )}
      {message.status === 'stopped' && <p className="px-1.5 text-xs italic text-[var(--color-muted)]">Stopped.</p>}
      {message.status === 'error' && (
        <p className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">{message.error || 'Something went wrong.'}</p>
      )}

      {!!message.sources?.length && !live && (
        <details className="px-1.5 text-xs text-[var(--color-muted)]">
          <summary className="cursor-pointer select-none">{plural(message.sources.length, 'source')}</summary>
          <ul className="mt-1 space-y-0.5">
            {message.sources.slice(0, 12).map((s) => (
              <li key={s.url} className="truncate">
                <a href={s.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">{s.title || hostOf(s.url)}</a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function UserTurn({ message }: { message: ChatMessage }) {
  const where = [message.view?.datasetTopic, message.view?.itemName].filter(Boolean).join(' › ');
  return (
    <div className="ml-8 rounded-lg bg-[var(--color-wall-soft)] px-3 py-2 text-sm">
      <p className="whitespace-pre-wrap">{message.text}</p>
      {where && <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">about {where}</p>}
    </div>
  );
}
