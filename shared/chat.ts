// The Claude chat: the freeform way to read, question and change your data
// (manual.md). Claude works through tools; anything that would CHANGE data is
// staged as a changeset the user reviews — the same "propose, show the diff, accept"
// loop as Claude Code on a folder, with datasets in place of files.
import type {
  Dataset, Domain, ImageKind, Item, MapAxis, MapRegion, MissingField, ProposedItem, Subtopic, WorldMap,
} from './types.ts';

// ---- What's on screen ----

/** The context a message is sent with: what the user is looking at right now. Every
 *  level is optional — the dock can be opened from the world gate, where nothing is. */
export interface ChatView {
  domain?: Domain;
  datasetId?: string;
  datasetTopic?: string;
  itemId?: string;
  itemName?: string;
}

// ---- The transcript ----

/** One step of an assistant turn, in the order it happened. */
export type ChatBlock =
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id: string;
      /** Bare tool name — the Space's `mcp__app__` prefix is stripped on the way in. */
      name: string;
      /** The tool's input as it streams in, before `input` is known in full. */
      partial?: string;
      input?: unknown;
      result?: string;
      isError?: boolean;
      done: boolean;
    };

export type ChatStatus = 'queued' | 'running' | 'done' | 'error' | 'stopped';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** A user message's words, as typed — a saved command stays `/gaps` here. Assistant
   *  turns carry `blocks` instead. */
  text: string;
  /** User messages that used a saved command: the full prompt Claude was actually
   *  sent (server/src/prompts/commands). Absent when `text` was sent as-is. */
  prompt?: string;
  blocks: ChatBlock[];
  /** User messages: what was on screen when it was sent. */
  view?: ChatView;
  /** Assistant messages: the model that answered. */
  model?: string;
  status: ChatStatus;
  error?: string;
  /** Every changeset this turn staged into, oldest first. Usually one — but the user
   *  can accept a changeset while Claude is still working, and what it stages after
   *  that opens a new one. */
  changesetIds?: string[];
  sources?: { url: string; title?: string }[];
  usage?: { turns?: number; durationMs?: number };
  createdAt: string;
}

export interface ChatThread {
  id: string;
  /** The world the thread was started in — personal threads sit behind the sign-in. */
  domain: Domain | null;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadSummary {
  id: string;
  domain: Domain | null;
  title: string;
  status: ChatStatus;
  updatedAt: string;
}

/** How much effort Claude puts in before answering — a reasoning budget the Space maps
 *  to tokens, matching Claude's own low-to-max scale. Chosen per message in the dock. */
export type ChatEffort = 'low' | 'medium' | 'high' | 'max';
export const CHAT_EFFORTS: ReadonlyArray<{ id: ChatEffort; label: string }> = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'max', label: 'Max' },
];
export const DEFAULT_CHAT_EFFORT: ChatEffort = 'medium';

export interface ChatModel {
  id: string;
  name: string;
}

/** A saved prompt, typed as `/name` in the dock the way a slash command is in Claude
 *  Code. Lives as a Markdown file in server/src/prompts/commands; the body is what
 *  Claude is sent, the name is what the user sees. */
export interface ChatCommand {
  name: string;
  description: string;
}

/** The tool Claude uses to put a question to the user mid-turn (services/agentRun.ts).
 *  The turn waits; the answer goes back as the tool's result. */
export const ASK_USER_TOOL = 'ask_user';

export interface AskUserInput {
  question: string;
  /** Short answers to pick from. The user can always type something else. */
  options?: string[];
}

// ---- The live stream (server -> browser) ----

export type ChatStreamEvent =
  /** First event on every (re)connection: the thread as it stands, mid-turn included. */
  | { type: 'snapshot'; thread: ChatThread; changesets: Changeset[] }
  | { type: 'status'; messageId: string; status: ChatStatus; error?: string }
  | { type: 'delta'; messageId: string; text: string }
  | { type: 'thinking'; messageId: string; text: string }
  | { type: 'tool_start'; messageId: string; id: string; name: string }
  | { type: 'tool_input'; messageId: string; id: string; partial: string }
  | { type: 'tool_call'; messageId: string; id: string; name: string; input: unknown }
  | { type: 'tool_result'; messageId: string; id: string; isError: boolean; preview: string }
  | { type: 'sources'; messageId: string; sources: { url: string; title?: string }[] }
  | { type: 'usage'; messageId: string; turns?: number; durationMs?: number }
  | { type: 'changeset'; changeset: Changeset }
  /** The turn is over; the connection closes after this. */
  | { type: 'end' };

/**
 * Fold one stream event into a message. The server uses this to build the message it
 * persists; the browser uses the same function on the same events — so a transcript
 * replayed from storage and one watched live can never disagree about what happened.
 * Mutates and returns `message`.
 */
export function reduceMessage(message: ChatMessage, event: ChatStreamEvent): ChatMessage {
  const blocks = message.blocks;
  const last = blocks[blocks.length - 1];
  const toolBlock = (id: string) =>
    blocks.find((b): b is Extract<ChatBlock, { type: 'tool' }> => b.type === 'tool' && b.id === id);

  switch (event.type) {
    case 'delta':
      if (last?.type === 'text') last.text += event.text;
      else blocks.push({ type: 'text', text: event.text });
      break;
    case 'thinking':
      if (last?.type === 'thinking') last.text += event.text;
      else blocks.push({ type: 'thinking', text: event.text });
      break;
    case 'tool_start':
      if (!toolBlock(event.id)) blocks.push({ type: 'tool', id: event.id, name: event.name, done: false });
      break;
    case 'tool_input': {
      const block = toolBlock(event.id);
      if (block) block.partial = (block.partial ?? '') + event.partial;
      break;
    }
    case 'tool_call': {
      const block = toolBlock(event.id);
      if (block) {
        block.input = event.input;
        delete block.partial;
      } else {
        blocks.push({ type: 'tool', id: event.id, name: event.name, input: event.input, done: false });
      }
      break;
    }
    case 'tool_result': {
      const block = toolBlock(event.id);
      if (block) {
        block.result = event.preview;
        block.isError = event.isError;
        block.done = true;
      }
      break;
    }
    case 'sources':
      message.sources = event.sources;
      break;
    case 'usage':
      message.usage = { turns: event.turns, durationMs: event.durationMs };
      break;
    case 'status':
      message.status = event.status;
      message.error = event.error;
      // A turn that ended mid-tool leaves that tool spinning forever otherwise.
      if (event.status !== 'running' && event.status !== 'queued') {
        for (const b of blocks) if (b.type === 'tool') b.done = true;
      }
      break;
    default:
      break;
  }
  return message;
}

// ---- Changesets: staged edits awaiting approval ----

/** The item fields Claude may propose edits to. Deliberately not `id`, `createdAt`,
 *  `capture` or `tweet` — identity, provenance and imported content aren't Claude's. */
export type ItemPatch = Partial<
  Pick<
    Item,
    | 'name'
    | 'description'
    | 'year'
    | 'brand'
    | 'creator'
    | 'definingFact'
    | 'subtopic'
    | 'url'
    | 'image'
    | 'imageKind'
    | 'imageQuery'
    | 'wikipediaTitle'
  >
>;

export const ITEM_PATCH_KEYS: ReadonlyArray<keyof ItemPatch> = [
  'name', 'description', 'year', 'brand', 'creator', 'definingFact', 'subtopic',
  'url', 'image', 'imageKind', 'imageQuery', 'wikipediaTitle',
];

export interface DatasetPatch {
  topic?: string;
  description?: string;
  subtopics?: Subtopic[];
}

/** pending  — staged, awaiting the user
 *  applied  — written
 *  rejected — the user said no (or Claude withdrew it)
 *  conflict — the data moved since this was staged; needs a second look
 *  failed   — couldn't be written; `problem` says why */
export type ChangeOpStatus = 'pending' | 'applied' | 'rejected' | 'conflict' | 'failed';

interface OpBase {
  id: string;
  status: ChangeOpStatus;
  /** Claude's reason, shown beside the change. */
  why?: string;
  /** Why it's `conflict` or `failed`. */
  problem?: string;
}

export type ChangeOp =
  | (OpBase & {
      kind: 'item.add';
      datasetId: string;
      /** Carries the id the item will be saved under, so later ops can refer to it. */
      item: ProposedItem & { id: string; imageKind?: ImageKind };
      /** True while the image pipeline is still looking for its picture. */
      imagePending?: boolean;
    })
  | (OpBase & {
      kind: 'item.update';
      datasetId: string;
      itemId: string;
      itemName: string;
      patch: ItemPatch;
      /** The same keys as `patch`, as they were when staged — the red half of the diff,
       *  and what apply compares against to notice the item changed underneath it. */
      before: ItemPatch;
    })
  | (OpBase & { kind: 'item.remove'; datasetId: string; itemId: string; before: Item })
  | (OpBase & {
      kind: 'item.move';
      datasetId: string;
      itemId: string;
      itemName: string;
      toDatasetId: string;
      subtopic: string;
      beforeSubtopic: string;
    })
  | (OpBase & {
      kind: 'dataset.update';
      datasetId: string;
      patch: DatasetPatch;
      before: DatasetPatch;
      /** Subtopic renames (old name -> new name), carried onto the items filed there. */
      renames?: Record<string, string>;
    })
  | (OpBase & {
      kind: 'dataset.create';
      /** Minted when staged, so items can be added or moved into it in the same changeset. */
      datasetId: string;
      domain: Domain;
      topic: string;
      description: string;
      subtopics: Subtopic[];
    })
  /** Only ever an EMPTY dataset — a merge moves the items out first, in the same changeset. */
  | (OpBase & { kind: 'dataset.delete'; datasetId: string; domain: Domain; topic: string })
  // ---- The world map (types.ts's WorldMap). Same gate, same undo. ----
  | (OpBase & {
      kind: 'map.draw';
      domain: Domain;
      axes: { x: MapAxis; y: MapAxis };
      regions: MapRegion[];
      /** Dataset id -> region id. */
      assignments: Record<string, string>;
      /** Dataset id -> topic, for the diff. */
      fieldNames: Record<string, string>;
      /** True when this throws an existing map away rather than drawing the first one. */
      replaces: boolean;
    })
  | (OpBase & {
      kind: 'map.region';
      domain: Domain;
      action: 'add' | 'update' | 'remove';
      region: MapRegion;
      /** `update` only: the region as it was when staged. */
      before?: MapRegion;
    })
  | (OpBase & {
      kind: 'map.place';
      domain: Domain;
      /** A dataset id, or a proposed field's `ghost:` key. */
      fieldId: string;
      fieldName: string;
      regionId: string;
      regionName: string;
      beforeRegionName?: string;
    })
  | (OpBase & {
      kind: 'map.ghost';
      domain: Domain;
      action: 'add' | 'remove';
      /** A field the world is missing, shown as a dashed hole in its region. */
      field: MissingField;
      regionId: string;
      regionName: string;
    })
  // ---- Visitor reports (types.ts's ItemReport). Filed under the item's dataset. ----
  | (OpBase & {
      kind: 'report.resolve';
      datasetId: string;
      reportId: string;
      itemName: string;
      /** What the visitor wrote, so the diff can show what is being closed. */
      text: string;
    })
  // ---- The prompts Claude works from: the curation rulebook and the saved `/` commands
  // (services/promptStore.ts). Same gate as the data: Claude proposes, the user accepts.
  | (OpBase & {
      kind: 'prompt.update';
      /** 'rules' for the rulebook; otherwise the command name (`gaps` for /gaps). */
      name: string;
      promptKind: PromptKind;
      /** As it read when staged; null when the command did not exist yet. */
      before: PromptText | null;
      after: PromptText;
    });

export type PromptKind = 'rules' | 'command';

/** A prompt's editable text. `description` is what the `/` picker shows for a command
 *  and is unused for the rulebook. */
export interface PromptText {
  description: string;
  body: string;
}

export type MapOp = Extract<ChangeOp, { kind: `map.${string}` }>;
export const isMapOp = (op: ChangeOp): op is MapOp => op.kind.startsWith('map.');

/** The group key a prompt op is filed under, and its heading in the diff. */
export const promptGroup = (name: string) => `prompt:${name}`;
export const promptTitle = (name: string) => (name === 'rules' ? 'Curation rules' : `Saved prompt /${name}`);

/** What an op is filed under in the diff: the dataset it touches, its world's map, or
 *  the prompt it edits. */
export const opGroup = (op: ChangeOp): string =>
  isMapOp(op) ? `map:${op.domain}` : op.kind === 'prompt.update' ? promptGroup(op.name) : op.datasetId;

/** Every dataset an op reads or writes — none for map and prompt ops. */
export function opDatasetIds(op: ChangeOp): string[] {
  if (isMapOp(op) || op.kind === 'prompt.update' || op.kind === 'dataset.create') return [];
  if (op.kind === 'item.move') return [op.datasetId, op.toDatasetId];
  return [op.datasetId];
}

export type ChangeOpKind = ChangeOp['kind'];

/** How to put one applied op back. Recorded at apply time, consumed by revert. */
export type UndoRecord =
  | { opId: string; kind: 'item.add'; datasetId: string; itemId: string }
  | { opId: string; kind: 'item.update'; datasetId: string; itemId: string; before: ItemPatch }
  | { opId: string; kind: 'item.remove'; datasetId: string; item: Item; index: number }
  | {
      opId: string;
      kind: 'item.move';
      datasetId: string;
      toDatasetId: string;
      itemId: string;
      beforeSubtopic: string;
      index: number;
    }
  | {
      opId: string;
      kind: 'dataset.update';
      datasetId: string;
      before: DatasetPatch;
      itemSubtopics: Record<string, string>;
    }
  | { opId: string; kind: 'dataset.create'; datasetId: string }
  /** The deleted dataset (it was empty), and where it sat on the map. */
  | { opId: string; kind: 'dataset.delete'; datasetId: string; dataset: Dataset; regionId?: string }
  /** The whole map as it was before this apply touched it — maps are small, and a
   *  snapshot is the one undo that is right whatever combination of map ops ran. */
  | { opId: string; kind: 'map'; domain: Domain; before: WorldMap | null }
  | { opId: string; kind: 'report.resolve'; reportId: string }
  /** `restore` is the stored override as it was — null means there was none, so undo
   *  deletes the override and the prompt falls back to the file it ships with. */
  | { opId: string; kind: 'prompt.update'; name: string; promptKind: PromptKind; restore: PromptText | null };

/** open      — has pending ops
 *  applied   — nothing pending, at least one applied
 *  discarded — nothing pending, nothing applied
 *  reverted  — applied, then undone */
export type ChangesetStatus = 'open' | 'applied' | 'discarded' | 'reverted';

export interface Changeset {
  id: string;
  threadId: string;
  status: ChangesetStatus;
  ops: ChangeOp[];
  /** Topic per dataset id the ops touch, so the diff can be grouped and titled without
   *  loading every dataset. Includes datasets this changeset itself creates. */
  datasetTopics: Record<string, string>;
  undo: UndoRecord[];
  createdAt: string;
  updatedAt: string;
}

/** What apply/revert hand back, so the browser can republish exactly what changed
 *  (web/lib/data.ts) instead of refetching the world. */
export interface ChangesetResult {
  changeset: Changeset;
  updated: Dataset[];
  deletedTopics: string[];
  /** Every world map the decision changed, as it now stands. */
  maps: WorldMap[];
}

export function changesetStatusOf(ops: ChangeOp[], reverted = false): ChangesetStatus {
  if (reverted) return 'reverted';
  if (ops.some((o) => o.status === 'pending' || o.status === 'conflict')) return 'open';
  return ops.some((o) => o.status === 'applied') ? 'applied' : 'discarded';
}
