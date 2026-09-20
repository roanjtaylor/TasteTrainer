// The tools Claude is given in the chat (plan/claude-agent.md).
//
// Two kinds, and the split is the whole safety model:
//   READ tools     — free rein. Claude can look at anything the user can.
//   PROPOSE tools  — never write. They validate, then stage ops in the thread's changeset
//                    (services/changesets.ts) for the user to accept or not.
//
// A propose tool's RESULT is written for Claude, not the user: it says exactly what was
// staged and what was refused and why ("'Dive Watches' is not a subtopic of Watches; the
// subtopics are …"), so Claude corrects itself within the same turn. That replaces the
// old pattern of asking for JSON in a fixed shape and repairing it afterwards — the
// model gets told, instead of the code guessing.
//
// The manifest below travels to the HF Space with every run; the Space registers each
// entry with the Agent SDK and relays the calls back here (services/agentRun.ts).
import { getDataset, getWorldMap, listDatasets, listItemReports } from '../storage.ts';
import { attachImages } from '../routes/curation.ts';
import { mapWithLimit } from './imageResolvers.ts';
import { nameKey } from './itemHygiene.ts';
import { loadRules } from './curationRules.ts';
import { openChangeset, patchOps, project, projectMap, rejectOps, stageOps, type Workspace } from './changesets.ts';
import { applyMapOp, ghostKey } from './worldMap.ts';
import { newId } from '../util.ts';
import { DOMAINS, isCuratedDomain, mapSlug, singleWordTopic, slugifyTopic } from '../../../shared/types.ts';
import type { Dataset, Domain, Item, MapAxis, MapRegion, Subtopic, WorldMap } from '../../../shared/types.ts';
import { ITEM_PATCH_KEYS, isMapOp, type ChangeOp, type Changeset, type ChatView, type ItemPatch, type MapOp } from '../../../shared/chat.ts';

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolContext {
  threadId: string;
  view: ChatView;
  /** Whether this user is signed in — the personal world is closed to anyone else, to
   *  Claude acting for them included (server/src/auth.ts). */
  personal: boolean;
  /** Called whenever the changeset changes, so the live stream can carry the new diff. */
  onChangeset: (cs: Changeset) => void;
}

export interface ToolAnswer {
  text: string;
  isError?: boolean;
}

/** A refusal meant for Claude to read and act on. */
class ToolError extends Error {}

// ---- Schemas ----

const DATASET_REF = {
  type: 'string',
  description:
    'Which dataset: its id, or its topic name (e.g. "Watches"). Omit to mean the dataset the user is currently viewing.',
};

const ITEM_FIELDS = {
  name: { type: 'string', description: 'What it is, e.g. "Eames Lounge Chair".' },
  description: { type: 'string', description: "Short note on why it's considered great — what to look at and why it matters." },
  year: { type: ['integer', 'null'], description: 'Year made/released, or null if genuinely unknown.' },
  brand: { type: 'string', description: 'Company/maker, or "" where there is none.' },
  creator: { type: 'string', description: 'The individual responsible (designer, artist, architect), or "".' },
  definingFact: { type: 'string', description: 'One sentence: the notable fact that gives the item its place in the field.' },
  subtopic: { type: 'string', description: "Exactly one of the dataset's subtopic names." },
  url: { type: 'string', description: 'Digital world, websites only: the canonical site address. Never a Wikipedia url.' },
  imageKind: {
    type: 'string',
    enum: ['archived-site', 'live-site', 'software-ui', 'artifact'],
    description:
      'Digital world only — how a picture can be obtained: archived-site (a website\'s PAST design), live-site (its present design), software-ui (non-web software, OS shells, pre-web), artifact (icon set, typeface, logo, poster, motion still).',
  },
  wikipediaTitle: { type: 'string', description: 'Most likely English Wikipedia article title, or "".' },
  imageQuery: {
    type: 'string',
    description:
      'A precise image-search phrase for THIS EXACT item — brand, specific model/reference/version AND year, e.g. "Rolex Submariner ref. 5513 1965". The image pipeline uses it to find the picture.',
  },
};

const SUBTOPICS_SCHEMA = {
  type: 'array',
  description: 'The COMPLETE new subtopic list (it replaces the old one).',
  items: {
    type: 'object',
    properties: { name: { type: 'string' }, description: { type: 'string' } },
    required: ['name', 'description'],
  },
};

const AXIS_SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string' }, low: { type: 'string' }, high: { type: 'string' } },
  required: ['label', 'low', 'high'],
};

const REGION_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short and evocative, e.g. "Worn & Carried".' },
    description: { type: 'string', description: 'One sentence: what belongs here.' },
    x: { type: 'number', description: "0–1: where the region sits along the x axis (0 = the axis's low end)." },
    y: { type: 'number', description: '0–1 along the y axis.' },
  },
  required: ['name', 'description', 'x', 'y'],
};

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'list_datasets',
    description: "List the user's datasets (fields) with item counts. Optionally one world only.",
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', enum: [...DOMAINS], description: 'Limit to one world.' } },
    },
  },
  {
    name: 'get_dataset',
    description:
      'Read a dataset: its description, subtopics and items. detail "compact" gives one line per item (id, name, maker, year, subtopic); "full" gives every field of every item, paged. Use compact to survey, full when you need descriptions/facts.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: DATASET_REF,
        detail: { type: 'string', enum: ['compact', 'full'], description: 'Default compact.' },
        subtopic: { type: 'string', description: 'Only items in this subtopic.' },
        offset: { type: 'integer', description: 'Skip this many items (paging).' },
      },
    },
  },
  {
    name: 'get_items',
    description: 'Read specific items in full, by id.',
    inputSchema: {
      type: 'object',
      properties: { dataset: DATASET_REF, itemIds: { type: 'array', items: { type: 'string' } } },
      required: ['itemIds'],
    },
  },
  {
    name: 'search_items',
    description:
      'Find items by text across one dataset or all of them — matches name, maker, creator, description, defining fact and subtopic.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        dataset: { ...DATASET_REF, description: 'Limit to one dataset (id or topic). Omit to search everything.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_world_map',
    description:
      "Read one world's map as it stands (pending map changes included): its two axes, its regions, which dataset sits in which region, datasets not yet placed, and the missing fields already proposed on it.",
    inputSchema: {
      type: 'object',
      properties: { domain: { type: 'string', enum: ['physical', 'digital'], description: 'Omit to mean the world the user is viewing.' } },
    },
  },
  {
    name: 'get_curation_rules',
    description:
      "The user's own curation rulebook: how fields are mapped, the anti-popularity-bias rules, dedup, what makes an item 'defining', and how a whole world is reviewed and mapped. Read it once before proposing new items, restructuring a field, or reviewing or mapping a world (physical or digital).",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_pending_changes',
    description: 'List the changes already staged in this conversation and still awaiting the user, with their ids.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_item_reports',
    description:
      "Read visitor-flagged problems on items — left by flipping a picture in the public embed widget (wrong info, a bad picture, anything off). Check this before refining a dataset the user mentions reports for, or when they ask what's been flagged.",
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { ...DATASET_REF, description: 'Limit to one dataset (id or topic). Omit to see reports across every dataset.' },
        status: { type: 'string', enum: ['open', 'resolved'], description: 'Default open.' },
      },
    },
  },
  {
    name: 'propose_add_items',
    description:
      'Stage NEW items for a dataset. Nothing is saved until the user accepts. Fill every field you can. Pictures are found automatically from wikipediaTitle/imageQuery/url — do not supply image urls. Send large additions in batches of about 10 per call.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: DATASET_REF,
        items: {
          type: 'array',
          items: { type: 'object', properties: ITEM_FIELDS, required: ['name', 'description', 'year', 'subtopic'] },
        },
        why: { type: 'string', description: 'One line on what this batch is for, shown to the user.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'propose_update_items',
    description:
      'Stage edits to existing items — corrections, fuller descriptions, re-filing under another subtopic. Each patch holds ONLY the fields that change. Batch many items into one call.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: DATASET_REF,
        updates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string' },
              patch: { type: 'object', properties: { ...ITEM_FIELDS, image: { type: 'string', description: 'A direct image url. Only when the user asks for a specific picture.' } } },
              why: { type: 'string', description: 'Why this change, in a few words.' },
            },
            required: ['itemId', 'patch'],
          },
        },
      },
      required: ['updates'],
    },
  },
  {
    name: 'propose_remove_items',
    description: 'Stage items for removal. The user sees each one in red and must tick it themselves.',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: DATASET_REF,
        itemIds: { type: 'array', items: { type: 'string' } },
        why: { type: 'string', description: 'The reason, shown beside each removal.' },
      },
      required: ['itemIds', 'why'],
    },
  },
  {
    name: 'propose_move_items',
    description: 'Stage moving items from one dataset to another (which may be one created earlier in this conversation).',
    inputSchema: {
      type: 'object',
      properties: {
        dataset: { ...DATASET_REF, description: 'The dataset the items are in now.' },
        itemIds: { type: 'array', items: { type: 'string' } },
        toDataset: { type: 'string', description: 'Destination dataset: id or topic name.' },
        subtopic: { type: 'string', description: "Which of the DESTINATION's subtopics to file them under." },
        why: { type: 'string' },
      },
      required: ['itemIds', 'toDataset', 'subtopic'],
    },
  },
  {
    name: 'propose_update_dataset',
    description:
      "Stage a change to a dataset itself: its one-word topic name, its description, or its subtopic list. When renaming or merging subtopics, give `subtopicRenames` so the items filed there follow; every item must still have a valid subtopic afterwards.",
    inputSchema: {
      type: 'object',
      properties: {
        dataset: DATASET_REF,
        topic: { type: 'string', description: 'New name — a SINGLE WORD, e.g. "Watches".' },
        description: { type: 'string' },
        subtopics: SUBTOPICS_SCHEMA,
        subtopicRenames: {
          type: 'array',
          items: {
            type: 'object',
            properties: { from: { type: 'string' }, to: { type: 'string' } },
            required: ['from', 'to'],
          },
        },
        why: { type: 'string' },
      },
    },
  },
  {
    name: 'propose_create_dataset',
    description:
      'Stage a brand-new dataset (field). Returns its id, which you can use straight away in propose_add_items / propose_move_items within this conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: [...DOMAINS] },
        topic: { type: 'string', description: 'A SINGLE WORD, e.g. "Watches".' },
        description: { type: 'string', description: "One or two sentences capturing the field's core idea." },
        subtopics: { ...SUBTOPICS_SCHEMA, description: 'The minimum set of distinct subtopics that together cover the field.' },
        region: { type: 'string', description: "Where it goes on the world's map: one of the map's region names (see get_world_map). Give this whenever the world has a map." },
        why: { type: 'string' },
      },
      required: ['domain', 'topic', 'description', 'subtopics'],
    },
  },
  {
    name: 'propose_delete_dataset',
    description:
      'Stage deleting a dataset that is EMPTY — the last step of merging one field into another: first stage moving (or removing) every item, then this. Refused while the dataset would still hold items.',
    inputSchema: {
      type: 'object',
      properties: { dataset: { type: 'string', description: 'Id or topic name. Required — never defaults to the current view.' }, why: { type: 'string' } },
      required: ['dataset', 'why'],
    },
  },
  {
    name: 'propose_draw_map',
    description:
      "Stage a world's map for the FIRST time (or, with redraw: true and only when the user asks, from scratch). You decide meaning, the app decides pixels: choose two axes that genuinely organise this world, 4–8 named regions positioned on them, and put EVERY dataset in exactly one region. Read get_curation_rules (the field-map sections) first.",
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['physical', 'digital'] },
        axes: {
          type: 'object',
          description: 'x runs left→right, y bottom→top. Each: a label and what its low and high ends mean, e.g. { label: "Scale", low: "held in the hand", high: "inhabited" }.',
          properties: { x: AXIS_SCHEMA, y: AXIS_SCHEMA },
          required: ['x', 'y'],
        },
        regions: { type: 'array', items: REGION_SCHEMA },
        assignments: {
          type: 'array',
          description: 'One entry per dataset of this world.',
          items: {
            type: 'object',
            properties: { dataset: { type: 'string', description: 'Id or topic name.' }, region: { type: 'string', description: 'A region name from `regions`.' } },
            required: ['dataset', 'region'],
          },
        },
        redraw: { type: 'boolean', description: 'Throw the existing map away. Only when the user explicitly asked to start over.' },
        why: { type: 'string', description: 'One or two sentences on how this world divides, shown to the user.' },
      },
      required: ['domain', 'axes', 'regions', 'assignments'],
    },
  },
  {
    name: 'propose_map_changes',
    description:
      "Stage amendments to a world's existing map — any mix, in one call: add / update (rename, re-describe, reposition) / remove regions, move datasets between regions, and add or drop PROPOSED MISSING FIELDS (fields of this world the user has no dataset for — the unknown-unknowns — drawn as dashed holes they can start a dataset from). A settled map is something the user has learned: change what is wrong, leave the rest.",
    inputSchema: {
      type: 'object',
      properties: {
        domain: { type: 'string', enum: ['physical', 'digital'], description: 'Omit to mean the world the user is viewing.' },
        addRegions: { type: 'array', items: REGION_SCHEMA },
        updateRegions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              region: { type: 'string', description: 'The region as it is named now.' },
              name: { type: 'string' }, description: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' },
            },
            required: ['region'],
          },
        },
        removeRegions: { type: 'array', items: { type: 'string' }, description: 'Region names. A region must be empty (after the placements in this call) to be removed.' },
        placements: {
          type: 'array',
          items: {
            type: 'object',
            properties: { field: { type: 'string', description: 'A dataset (id or topic), or a proposed missing field (topic).' }, region: { type: 'string' } },
            required: ['field', 'region'],
          },
        },
        addMissingFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: 'A SINGLE WORD, ready to become the dataset name.' },
              description: { type: 'string', description: "One or two sentences capturing the field's core idea." },
              why: { type: 'string', description: 'Why this field matters to someone mapping this world.' },
              region: { type: 'string' },
            },
            required: ['topic', 'description', 'why', 'region'],
          },
        },
        removeMissingFields: { type: 'array', items: { type: 'string' }, description: 'Topics of proposed fields to drop from the map.' },
        why: { type: 'string' },
      },
    },
  },
  {
    name: 'withdraw_changes',
    description: 'Un-stage changes you proposed earlier in this conversation (ids from get_pending_changes), e.g. because the user asked you to drop or redo them.',
    inputSchema: {
      type: 'object',
      properties: { opIds: { type: 'array', items: { type: 'string' } } },
      required: ['opIds'],
    },
  },
];

// ---- Helpers ----

/** Tool results travel back through the Agent SDK, which refuses very large ones. */
const RESULT_BUDGET = 48_000;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = <T = any>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function compactLine(i: Item): string {
  const maker = i.brand || i.creator || '—';
  return `${i.id} | ${i.name} | ${maker} | ${i.year ?? '?'} | ${i.subtopic || 'unfiled'}`;
}

/** An item as Claude should see it: every meaningful field, none of the plumbing
 *  (signed image links, capture provenance, alternative pictures). */
export function itemForClaude(i: Item): Record<string, unknown> {
  return {
    id: i.id,
    name: i.name,
    description: i.description,
    year: i.year,
    brand: i.brand,
    creator: i.creator,
    definingFact: i.definingFact,
    subtopic: i.subtopic,
    ...(i.url ? { url: i.url } : {}),
    ...(i.imageKind ? { imageKind: i.imageKind } : {}),
    hasImage: !!i.image,
    ...(i.tweet
      ? { savedThread: i.tweet.tweets?.map((t: any) => str(t.text)).filter(Boolean).join('\n---\n').slice(0, 3000) }
      : {}),
  };
}

export function datasetHeader(ds: Dataset): string {
  const subs = ds.subtopics.length
    ? ds.subtopics.map((s) => `  - ${s.name}: ${s.description}`).join('\n')
    : '  (none)';
  return `Dataset "${ds.topic}" — id ${ds.id}, ${ds.domain} world, ${ds.items.length} items\nDescription: ${ds.description}\nSubtopics:\n${subs}`;
}

export function compactInventory(items: Item[]): string {
  return `id | name | maker | year | subtopic\n${items.map(compactLine).join('\n')}`;
}

function guardPersonal(ctx: ToolContext, domain: Domain): void {
  if (domain === 'personal' && !ctx.personal) {
    throw new ToolError('The personal world is private and the user is not signed in, so it cannot be read or changed.');
  }
}

/** Resolve a dataset reference — id, slug or topic name — looking first at datasets
 *  this conversation has staged but not yet created. */
async function resolveDataset(ctx: ToolContext, ref: unknown, ws?: Workspace): Promise<Dataset> {
  const wanted = str(ref) || ctx.view.datasetId || '';
  if (!wanted) throw new ToolError('No dataset was named and the user is not viewing one. Pass `dataset` (see list_datasets).');
  const staged = ws && [...ws.values()].find((d) => d.id === wanted || slugifyTopic(d.topic) === slugifyTopic(wanted));
  const ds = staged ?? (await getDataset(wanted)) ?? (await getDataset(slugifyTopic(wanted)));
  if (!ds) throw new ToolError(`There is no dataset "${wanted}". Use list_datasets to see what exists.`);
  guardPersonal(ctx, ds.domain);
  return ds;
}

/** The dataset as it will be once the pending changes land — what proposals are
 *  validated against. Includes datasets the changeset itself creates. */
async function projected(ctx: ToolContext, ref: unknown): Promise<{ ds: Dataset; ws: Workspace; cs: Changeset | null }> {
  const cs = await openChangeset(ctx.threadId);
  let ws = await project(cs);
  const saved = await resolveDataset(ctx, ref, ws);
  if (!ws.has(saved.id)) ws = await project(cs, [saved.id]);
  return { ds: ws.get(saved.id) ?? saved, ws, cs };
}

function subtopicOf(value: unknown, subtopics: Subtopic[]): string | null {
  const key = str(value).toLowerCase().replace(/\s+/g, ' ');
  const match = subtopics.find((s) => s.name.trim().toLowerCase().replace(/\s+/g, ' ') === key);
  return match ? match.name : null;
}

const subtopicNames = (ds: Dataset) => ds.subtopics.map((s) => `"${s.name}"`).join(', ') || '(this dataset has no subtopics)';

function cleanYear(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function describeOp(op: ChangeOp, topics: Record<string, string>): string {
  if (isMapOp(op)) {
    switch (op.kind) {
      case 'map.draw': return `${op.replaces ? 'redraw' : 'draw'} the ${op.domain} map (${op.regions.length} regions)`;
      case 'map.region': return `${op.action} map region "${op.region.name}" (${op.domain})`;
      case 'map.place': return `put ${op.fieldName} in map region "${op.regionName}"`;
      case 'map.ghost': return `${op.action === 'add' ? 'propose' : 'drop'} missing field ${op.field.topic} on the ${op.domain} map`;
    }
  }
  const where = topics[op.datasetId] ?? op.datasetId;
  switch (op.kind) {
    case 'item.add': return `add "${op.item.name}" to ${where}`;
    case 'item.update': return `edit "${op.itemName}" in ${where} (${Object.keys(op.patch).join(', ')})`;
    case 'item.remove': return `remove "${op.before.name}" from ${where}`;
    case 'item.move': return `move "${op.itemName}" from ${where} to ${topics[op.toDatasetId] ?? op.toDatasetId}`;
    case 'dataset.update': return `change ${where}'s ${Object.keys(op.patch).join(', ')}`;
    case 'dataset.create': return `create dataset ${op.topic}`;
    case 'dataset.delete': return `delete the emptied dataset ${op.topic}`;
  }
}

const STAGED_NOTE = 'These are PROPOSALS: the user now sees them as a diff and decides. Do not tell them anything has been saved.';

// ---- Read tools ----

async function listDatasetsTool(ctx: ToolContext, input: any): Promise<string> {
  const domain = DOMAINS.includes(input?.domain) ? (input.domain as Domain) : undefined;
  if (domain) guardPersonal(ctx, domain);
  const all = (await listDatasets(domain)).filter((d) => ctx.personal || d.domain !== 'personal');
  if (!all.length) return 'No datasets yet.';
  return all
    .map((d) => `${d.topic} — id ${d.id} · ${d.domain} · ${d.itemCount} items, ${d.subtopicCount} subtopics\n    ${d.description}`)
    .join('\n');
}

async function getDatasetTool(ctx: ToolContext, input: any): Promise<string> {
  const ds = await resolveDataset(ctx, input?.dataset);
  const wantedSub = str(input?.subtopic);
  const pool = wantedSub ? ds.items.filter((i) => subtopicOf(i.subtopic, [{ name: wantedSub, description: '' }])) : ds.items;
  const offset = Math.max(0, Number(input?.offset) || 0);
  const full = input?.detail === 'full';

  const lines: string[] = [];
  let used = 0;
  let shown = 0;
  for (const item of pool.slice(offset)) {
    const line = full ? JSON.stringify(itemForClaude(item)) : compactLine(item);
    if (used + line.length > RESULT_BUDGET) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  const more =
    offset + shown < pool.length
      ? `\n\nShowing items ${offset + 1}–${offset + shown} of ${pool.length}. Call again with offset ${offset + shown} for more.`
      : '';
  const head = full ? '' : 'id | name | maker | year | subtopic\n';
  return `${datasetHeader(ds)}\n\nItems${wantedSub ? ` in "${wantedSub}"` : ''} (${pool.length}):\n${head}${lines.join('\n')}${more}`;
}

async function getItemsTool(ctx: ToolContext, input: any): Promise<string> {
  const ds = await resolveDataset(ctx, input?.dataset);
  const ids = new Set(list<string>(input?.itemIds));
  const found = ds.items.filter((i) => ids.has(i.id));
  if (!found.length) throw new ToolError(`None of those ids are items of ${ds.topic}.`);
  return found.map((i) => JSON.stringify(itemForClaude(i), null, 1)).join('\n').slice(0, RESULT_BUDGET);
}

async function searchItemsTool(ctx: ToolContext, input: any): Promise<string> {
  const terms = str(input?.query).toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) throw new ToolError('query is required.');
  const datasets: Dataset[] = str(input?.dataset)
    ? [await resolveDataset(ctx, input.dataset)]
    : (
        await Promise.all(
          (await listDatasets())
            .filter((d) => ctx.personal || d.domain !== 'personal')
            .map((d) => getDataset(d.id)),
        )
      ).filter((d): d is Dataset => !!d);

  const hits: string[] = [];
  for (const ds of datasets) {
    for (const i of ds.items) {
      const hay = [i.name, i.brand, i.creator, i.description, i.definingFact, i.subtopic, String(i.year ?? '')]
        .join(' ')
        .toLowerCase();
      if (terms.every((t) => hay.includes(t))) hits.push(`[${ds.topic}] ${compactLine(i)}`);
      if (hits.length >= 80) break;
    }
  }
  return hits.length ? `dataset | id | name | maker | year | subtopic\n${hits.join('\n')}` : 'No items match.';
}

async function pendingChangesTool(ctx: ToolContext): Promise<string> {
  const cs = await openChangeset(ctx.threadId);
  const pending = (cs?.ops ?? []).filter((o) => o.status === 'pending' || o.status === 'conflict');
  if (!cs || !pending.length) return 'Nothing is staged.';
  return pending.map((o) => `${o.id} — ${describeOp(o, cs.datasetTopics)}`).join('\n');
}

async function getItemReportsTool(ctx: ToolContext, input: any): Promise<string> {
  const status = input?.status === 'resolved' ? 'resolved' : 'open';
  const datasetId = str(input?.dataset) ? (await resolveDataset(ctx, input.dataset)).id : undefined;
  const reports = (await listItemReports({ datasetId, status })).filter(
    (r) => ctx.personal || r.domain !== 'personal',
  );
  if (!reports.length) return `No ${status} item reports${datasetId ? ' for this dataset' : ''}.`;
  return reports
    .map((r) => `${r.id} — dataset ${r.datasetId}, item "${r.itemName}" (${r.itemId}): ${r.text}`)
    .join('\n');
}

// ---- Propose tools ----

async function stage(ctx: ToolContext, ops: ChangeOp[], topics: Record<string, string>): Promise<Changeset> {
  const cs = await stageOps(ctx.threadId, ops, topics);
  ctx.onChangeset(cs);
  return cs;
}

/** Find pictures for freshly staged items, one at a time, patching each op as its
 *  picture lands — the diff fills in while the user reads it. Fire-and-forget: a turn
 *  does not wait on Wikimedia. */
function resolveImages(ctx: ToolContext, cs: Changeset, ops: ChangeOp[], domain: Domain): void {
  const adds = ops.filter((o): o is Extract<ChangeOp, { kind: 'item.add' }> => o.kind === 'item.add');
  void mapWithLimit(adds, 3, async (op) => {
    let resolved: Awaited<ReturnType<typeof attachImages>>[number] | null = null;
    try {
      [resolved] = await attachImages([op.item], domain, () => {});
    } catch { /* leaves the item without a picture; the user can pick one after accepting */ }
    const next = await patchOps(ctx.threadId, cs.id, (o) => {
      if (o.kind !== 'item.add' || o.id !== op.id) return;
      o.imagePending = false;
      if (resolved) o.item = { ...o.item, image: resolved.image, capture: resolved.capture, candidates: resolved.candidates };
    });
    if (next) ctx.onChangeset(next);
  });
}

async function proposeAddItems(ctx: ToolContext, input: any): Promise<string> {
  const { ds } = await projected(ctx, input?.dataset);
  const seen = new Set(ds.items.map((i) => nameKey(i.name)));
  const curated = isCuratedDomain(ds.domain);
  const ops: ChangeOp[] = [];
  const refused: string[] = [];

  for (const raw of list(input?.items)) {
    const name = str(raw?.name);
    if (!name) { refused.push('(an item with no name)'); continue; }
    const key = nameKey(name);
    if (key && seen.has(key)) { refused.push(`"${name}" — already in ${ds.topic} (or already staged)`); continue; }
    const subtopic = ds.subtopics.length ? subtopicOf(raw?.subtopic, ds.subtopics) : str(raw?.subtopic);
    if (subtopic === null) { refused.push(`"${name}" — "${str(raw?.subtopic)}" is not a subtopic of ${ds.topic}`); continue; }
    seen.add(key);
    ops.push({
      id: newId(),
      kind: 'item.add',
      status: 'pending',
      why: str(input?.why) || undefined,
      datasetId: ds.id,
      imagePending: curated,
      item: {
        id: newId(),
        name,
        description: str(raw?.description),
        year: cleanYear(raw?.year),
        brand: str(raw?.brand),
        creator: str(raw?.creator),
        definingFact: str(raw?.definingFact),
        subtopic,
        url: str(raw?.url),
        imageKind: raw?.imageKind,
        wikipediaTitle: str(raw?.wikipediaTitle) || undefined,
        imageQuery: str(raw?.imageQuery) || undefined,
        image: '',
      },
    });
  }

  if (ops.length) {
    const cs = await stage(ctx, ops, { [ds.id]: ds.topic });
    if (curated) resolveImages(ctx, cs, ops, ds.domain);
  }
  const refusedBlock = refused.length
    ? `\nRefused ${refused.length}:\n${refused.map((r) => `- ${r}`).join('\n')}${refused.some((r) => r.includes('not a subtopic')) ? `\nThe subtopics of ${ds.topic} are: ${subtopicNames(ds)}.` : ''}`
    : '';
  return `Staged ${ops.length} new item${ops.length === 1 ? '' : 's'} for ${ds.topic}.${refusedBlock}\n${STAGED_NOTE}`;
}

async function proposeUpdateItems(ctx: ToolContext, input: any): Promise<string> {
  const { ds, cs } = await projected(ctx, input?.dataset);
  const pendingAdds = new Map(
    (cs?.ops ?? [])
      .filter((o): o is Extract<ChangeOp, { kind: 'item.add' }> => o.kind === 'item.add' && o.status === 'pending')
      .map((o) => [o.item.id, o]),
  );
  const ops: ChangeOp[] = [];
  const refused: string[] = [];
  const amended: Array<{ opId: string; patch: ItemPatch }> = [];
  let unchanged = 0;

  for (const raw of list(input?.updates)) {
    const item = ds.items.find((i) => i.id === str(raw?.itemId));
    if (!item) { refused.push(`${str(raw?.itemId) || '(no id)'} — not an item of ${ds.topic}`); continue; }

    const patch: ItemPatch = {};
    const before: ItemPatch = {};
    let bad = '';
    for (const key of ITEM_PATCH_KEYS) {
      if (!raw?.patch || !(key in raw.patch)) continue;
      let value: unknown = key === 'year' ? cleanYear(raw.patch[key]) : str(raw.patch[key]);
      if (key === 'subtopic' && ds.subtopics.length) {
        value = subtopicOf(value, ds.subtopics);
        if (value === null) { bad = `"${str(raw.patch.subtopic)}" is not a subtopic of ${ds.topic}`; break; }
      }
      if (key === 'image' && ds.domain === 'personal') { bad = 'pictures in the personal world are the user\'s own uploads'; break; }
      if (JSON.stringify(value ?? null) === JSON.stringify(item[key] ?? null)) continue;
      (patch as any)[key] = value;
      (before as any)[key] = item[key] ?? null;
    }
    if (bad) { refused.push(`"${item.name}" — ${bad}`); continue; }
    if (!Object.keys(patch).length) { unchanged += 1; continue; }

    // An item that is itself still only a proposal has no saved state to diff
    // against — fold the edit into the pending addition instead.
    const pendingAdd = pendingAdds.get(item.id);
    if (pendingAdd) { amended.push({ opId: pendingAdd.id, patch }); continue; }

    ops.push({
      id: newId(), kind: 'item.update', status: 'pending', why: str(raw?.why) || undefined,
      datasetId: ds.id, itemId: item.id, itemName: item.name, patch, before,
    });
  }

  if (amended.length && cs) {
    const next = await patchOps(ctx.threadId, cs.id, (o) => {
      const hit = amended.find((a) => a.opId === o.id);
      if (hit && o.kind === 'item.add') o.item = { ...o.item, ...hit.patch } as typeof o.item;
    });
    if (next) ctx.onChangeset(next);
  }
  if (ops.length) await stage(ctx, ops, { [ds.id]: ds.topic });

  const parts = [`Staged edits to ${ops.length} item${ops.length === 1 ? '' : 's'} in ${ds.topic}.`];
  if (amended.length) parts.push(`Amended ${amended.length} item(s) that are themselves still pending additions.`);
  if (unchanged) parts.push(`${unchanged} already had exactly those values, so nothing was staged for them.`);
  if (refused.length) {
    parts.push(`Refused ${refused.length}:\n${refused.map((r) => `- ${r}`).join('\n')}`);
    if (refused.some((r) => r.includes('not a subtopic'))) parts.push(`The subtopics of ${ds.topic} are: ${subtopicNames(ds)}.`);
  }
  return `${parts.join('\n')}\n${STAGED_NOTE}`;
}

async function proposeRemoveItems(ctx: ToolContext, input: any): Promise<string> {
  const { ds, cs } = await projected(ctx, input?.dataset);
  const why = str(input?.why);
  const ops: ChangeOp[] = [];
  const withdrawn: string[] = [];
  const refused: string[] = [];

  for (const id of list<string>(input?.itemIds)) {
    const item = ds.items.find((i) => i.id === id);
    if (!item) { refused.push(id); continue; }
    const pendingAdd = cs?.ops.find((o) => o.kind === 'item.add' && o.status === 'pending' && o.item.id === id);
    if (pendingAdd) { withdrawn.push(pendingAdd.id); continue; }
    ops.push({ id: newId(), kind: 'item.remove', status: 'pending', why, datasetId: ds.id, itemId: id, before: item });
  }

  if (withdrawn.length && cs) ctx.onChangeset(await rejectOps(ctx.threadId, cs.id, withdrawn));
  if (ops.length) await stage(ctx, ops, { [ds.id]: ds.topic });
  return [
    `Staged ${ops.length} removal${ops.length === 1 ? '' : 's'} from ${ds.topic}.`,
    withdrawn.length ? `Withdrew ${withdrawn.length} pending addition(s) instead of staging their removal.` : '',
    refused.length ? `Not items of ${ds.topic}: ${refused.join(', ')}` : '',
    STAGED_NOTE,
  ].filter(Boolean).join('\n');
}

async function proposeMoveItems(ctx: ToolContext, input: any): Promise<string> {
  const { ds, ws } = await projected(ctx, input?.dataset);
  const target = await resolveDataset(ctx, input?.toDataset, ws);
  const to = ws.get(target.id) ?? target;
  if (to.id === ds.id) throw new ToolError('Source and destination are the same dataset. To re-file within a dataset, use propose_update_items with a subtopic patch.');
  const subtopic = to.subtopics.length ? subtopicOf(input?.subtopic, to.subtopics) : str(input?.subtopic);
  if (subtopic === null) {
    throw new ToolError(`"${str(input?.subtopic)}" is not a subtopic of ${to.topic}. Its subtopics are: ${subtopicNames(to)}.`);
  }

  const ops: ChangeOp[] = [];
  const refused: string[] = [];
  for (const id of list<string>(input?.itemIds)) {
    const item = ds.items.find((i) => i.id === id);
    if (!item) { refused.push(id); continue; }
    ops.push({
      id: newId(), kind: 'item.move', status: 'pending', why: str(input?.why) || undefined,
      datasetId: ds.id, itemId: id, itemName: item.name, toDatasetId: to.id, subtopic, beforeSubtopic: item.subtopic,
    });
  }
  if (ops.length) await stage(ctx, ops, { [ds.id]: ds.topic, [to.id]: to.topic });
  return [
    `Staged moving ${ops.length} item${ops.length === 1 ? '' : 's'} from ${ds.topic} to ${to.topic} / ${subtopic}.`,
    refused.length ? `Not items of ${ds.topic}: ${refused.join(', ')}` : '',
    STAGED_NOTE,
  ].filter(Boolean).join('\n');
}

function cleanSubtopics(raw: unknown): Subtopic[] {
  return list(raw)
    .map((s: any) => ({ name: str(s?.name), description: str(s?.description) }))
    .filter((s) => s.name);
}

async function proposeUpdateDataset(ctx: ToolContext, input: any): Promise<string> {
  const { ds } = await projected(ctx, input?.dataset);
  const patch: Extract<ChangeOp, { kind: 'dataset.update' }>['patch'] = {};
  const before: typeof patch = {};

  const topic = str(input?.topic) ? singleWordTopic(str(input.topic)) : '';
  if (topic && topic !== ds.topic) {
    const clash = await getDataset(slugifyTopic(topic));
    if (clash && clash.id !== ds.id) throw new ToolError(`A dataset called ${clash.topic} already exists.`);
    patch.topic = topic; before.topic = ds.topic;
  }
  if (str(input?.description) && str(input.description) !== ds.description) {
    patch.description = str(input.description); before.description = ds.description;
  }

  const renames: Record<string, string> = {};
  if (Array.isArray(input?.subtopics)) {
    const subtopics = cleanSubtopics(input.subtopics);
    if (!subtopics.length) throw new ToolError('subtopics must list at least one { name, description }.');
    for (const r of list(input?.subtopicRenames)) {
      const from = subtopicOf(r?.from, ds.subtopics) ?? str(r?.from);
      const to = subtopicOf(r?.to, subtopics);
      if (!to) throw new ToolError(`subtopicRenames: "${str(r?.to)}" is not in the new subtopic list.`);
      renames[from] = to;
    }
    // Every item must still have a home. An item left pointing at a subtopic that no
    // longer exists is unreachable by every filter — and nothing would ever show it.
    const orphaned = new Map<string, number>();
    for (const item of ds.items) {
      const next = renames[item.subtopic] ?? item.subtopic;
      if (next && !subtopicOf(next, subtopics)) orphaned.set(item.subtopic, (orphaned.get(item.subtopic) ?? 0) + 1);
    }
    if (orphaned.size) {
      throw new ToolError(
        `That list would strand items: ${[...orphaned].map(([name, n]) => `${n} in "${name}"`).join(', ')}. ` +
          'Add a subtopicRenames entry for each (from the old name to one in the new list), or re-file those items first with propose_update_items.',
      );
    }
    if (JSON.stringify(subtopics) !== JSON.stringify(ds.subtopics)) {
      patch.subtopics = subtopics; before.subtopics = ds.subtopics;
    }
  } else if (list(input?.subtopicRenames).length) {
    throw new ToolError('subtopicRenames only makes sense together with a new `subtopics` list.');
  }

  if (!Object.keys(patch).length) return `Nothing to change — ${ds.topic} already has those values.`;
  await stage(
    ctx,
    [{
      id: newId(), kind: 'dataset.update', status: 'pending', why: str(input?.why) || undefined,
      datasetId: ds.id, patch, before, renames: Object.keys(renames).length ? renames : undefined,
    }],
    { [ds.id]: ds.topic },
  );
  return `Staged a change to ${ds.topic}'s ${Object.keys(patch).join(', ')}.\n${STAGED_NOTE}`;
}

async function proposeCreateDataset(ctx: ToolContext, input: any): Promise<string> {
  const domain = input?.domain as Domain;
  if (!DOMAINS.includes(domain)) throw new ToolError(`domain must be one of ${DOMAINS.join(', ')}.`);
  guardPersonal(ctx, domain);
  const topic = singleWordTopic(str(input?.topic));
  const description = str(input?.description);
  if (!topic || !description) throw new ToolError('topic and description are required.');

  const ws = await project(await openChangeset(ctx.threadId));
  const clash =
    (await getDataset(slugifyTopic(topic))) ??
    [...ws.values()].find((d) => slugifyTopic(d.topic) === slugifyTopic(topic));
  if (clash) throw new ToolError(`A dataset called ${clash.topic} already exists (id ${clash.id}) — add to it, or choose another name.`);

  // Checked before anything is staged, so a misnamed region refuses the whole call.
  const map = isCuratedDomain(domain) ? await projectMap(await openChangeset(ctx.threadId), domain) : null;
  const region = map && str(input?.region) ? regionOf(map, input.region) : null;

  const id = newId();
  await stage(
    ctx,
    [{
      id: newId(), kind: 'dataset.create', status: 'pending', why: str(input?.why) || undefined,
      datasetId: id, domain, topic, description,
      subtopics: cleanSubtopics(input?.subtopics),
    }],
    { [id]: topic },
  );

  // Its place on the map rides along as a change of its own, so a new field never
  // lands in whichever region happens to be first.
  let placed = '';
  if (map && region) {
    await stage(
      ctx,
      [{ id: newId(), kind: 'map.place', status: 'pending', domain, fieldId: id, fieldName: topic, regionId: region.id, regionName: region.name }],
      { [`map:${domain}`]: `The ${domain} map` },
    );
    placed = ` It is placed in the map region "${region.name}".`;
  } else if (map && !map.ghosts.some((g) => g.key === ghostKey(topic))) {
    placed = ` It has NO place on the ${domain} map yet — stage one with propose_map_changes (placements).`;
  }
  return `Staged a new ${domain} dataset "${topic}" with id ${id}.${placed} You can stage items into it now with propose_add_items or propose_move_items.\n${STAGED_NOTE}`;
}

// ---- The world map ----

const unit = (v: unknown, fallback = 0.5) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
};

function mapDomain(ctx: ToolContext, input: any): Domain {
  const domain = (DOMAINS.includes(input?.domain) ? input.domain : ctx.view.domain) as Domain | undefined;
  if (!domain) throw new ToolError(`Say which world: domain must be one of ${DOMAINS.filter(isCuratedDomain).join(', ')}.`);
  if (!isCuratedDomain(domain)) throw new ToolError('Only the physical and digital worlds have a map; the personal world is a plain shelf.');
  return domain;
}

/** Every dataset of a world as it will be once the pending changes land: staged
 *  creations included, staged deletions gone, staged renames applied. */
async function projectedFields(ctx: ToolContext, domain: Domain): Promise<Array<{ id: string; topic: string }>> {
  const cs = await openChangeset(ctx.threadId);
  const ws = await project(cs);
  const pendingDeletes = new Set(
    (cs?.ops ?? []).filter((o) => o.kind === 'dataset.delete' && o.status === 'pending').map((o) => (o as any).datasetId as string),
  );
  const fields = new Map<string, string>();
  for (const d of await listDatasets(domain)) fields.set(d.id, d.topic);
  for (const d of ws.values()) if (d.domain === domain) fields.set(d.id, d.topic);
  for (const id of pendingDeletes) fields.delete(id);
  return [...fields].map(([id, topic]) => ({ id, topic }));
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function regionOf(map: WorldMap, ref: unknown): MapRegion {
  const wanted = str(ref);
  const region = map.regions.find((r) => r.id === wanted || r.id === mapSlug(wanted) || sameName(r.name, wanted));
  if (!region) throw new ToolError(`"${wanted}" is not a region of this map. The regions are: ${map.regions.map((r) => `"${r.name}"`).join(', ')}.`);
  return region;
}

function describeMap(map: WorldMap, fields: Array<{ id: string; topic: string }>): string {
  const first = map.regions[0]?.id;
  const lines = [
    `Axes — across: ${map.axes.x.label} (${map.axes.x.low} → ${map.axes.x.high}); up: ${map.axes.y.label} (${map.axes.y.low} → ${map.axes.y.high}).`,
    'Regions (x, y are 0–1 positions on those axes):',
  ];
  for (const r of map.regions) {
    const here = fields.filter((f) => (map.placements[f.id]?.regionId ?? first) === r.id);
    const unplaced = here.filter((f) => !map.placements[f.id]).map((f) => f.topic);
    const holes = map.ghosts.filter((g) => g.regionId === r.id).map((g) => g.topic);
    lines.push(
      `- ${r.name} (x ${r.x}, y ${r.y}) — ${r.description}\n    datasets: ${here.map((f) => f.topic).join(', ') || '(none)'}` +
        (unplaced.length ? `\n    of which NOT YET PLACED (shown here only by default): ${unplaced.join(', ')}` : '') +
        (holes.length ? `\n    proposed missing fields (dashed holes): ${holes.join(', ')}` : ''),
    );
  }
  return lines.join('\n');
}

async function getWorldMapTool(ctx: ToolContext, input: any): Promise<string> {
  const domain = mapDomain(ctx, input);
  const map = await projectMap(await openChangeset(ctx.threadId), domain);
  const fields = await projectedFields(ctx, domain);
  if (!map) {
    return `The ${domain} world has no map yet. Its datasets: ${fields.map((f) => f.topic).join(', ') || '(none)'}. Draw one with propose_draw_map.`;
  }
  return describeMap(map, fields);
}

async function proposeDrawMap(ctx: ToolContext, input: any): Promise<string> {
  const domain = mapDomain(ctx, input);
  const cs = await openChangeset(ctx.threadId);
  const existing = await projectMap(cs, domain);
  if (existing && input?.redraw !== true) {
    throw new ToolError('This world already has a map, and the user has learned where things are. Amend it with propose_map_changes; pass redraw: true only if the user asked to start the map over.');
  }

  const axis = (raw: any, name: string): MapAxis => {
    const a = { label: str(raw?.label), low: str(raw?.low), high: str(raw?.high) };
    if (!a.label || !a.low || !a.high) throw new ToolError(`axes.${name} needs label, low and high.`);
    return a;
  };
  const axes = { x: axis(input?.axes?.x, 'x'), y: axis(input?.axes?.y, 'y') };

  const regions: MapRegion[] = [];
  for (const raw of list(input?.regions)) {
    const name = str(raw?.name);
    if (!name) continue;
    const id = mapSlug(name);
    if (regions.some((r) => r.id === id)) throw new ToolError(`Two regions are both called "${name}".`);
    regions.push({ id, name, description: str(raw?.description), x: unit(raw?.x), y: unit(raw?.y) });
  }
  if (regions.length < 2) throw new ToolError('A map needs at least two regions.');

  const fields = await projectedFields(ctx, domain);
  const assignments: Record<string, string> = {};
  const fieldNames: Record<string, string> = {};
  const problems: string[] = [];
  for (const raw of list(input?.assignments)) {
    const field = fields.find((f) => f.id === str(raw?.dataset) || sameName(f.topic, str(raw?.dataset)));
    const region = regions.find((r) => r.id === mapSlug(str(raw?.region)) || sameName(r.name, str(raw?.region)));
    if (!field) { problems.push(`"${str(raw?.dataset)}" is not a dataset of the ${domain} world`); continue; }
    if (!region) { problems.push(`"${str(raw?.region)}" is not one of the regions you listed`); continue; }
    assignments[field.id] = region.id;
    fieldNames[field.id] = field.topic;
  }
  const unassigned = fields.filter((f) => !assignments[f.id]).map((f) => f.topic);
  if (unassigned.length) problems.push(`every dataset needs a region — missing: ${unassigned.join(', ')}`);
  if (problems.length) throw new ToolError(`Nothing staged:\n${problems.map((p) => `- ${p}`).join('\n')}`);

  await stage(
    ctx,
    [{ id: newId(), kind: 'map.draw', status: 'pending', why: str(input?.why) || undefined, domain, axes, regions, assignments, fieldNames, replaces: !!existing }],
    { [`map:${domain}`]: `The ${domain} map` },
  );
  return `Staged a ${existing ? 'REDRAWN' : 'new'} ${domain} map: ${regions.length} regions, ${fields.length} datasets placed. Fields the world is missing can now be added with propose_map_changes.\n${STAGED_NOTE}`;
}

async function proposeMapChanges(ctx: ToolContext, input: any): Promise<string> {
  const domain = mapDomain(ctx, input);
  let map = await projectMap(await openChangeset(ctx.threadId), domain);
  if (!map) throw new ToolError(`The ${domain} world has no map yet — draw one first with propose_draw_map.`);
  const fields = await projectedFields(ctx, domain);
  const why = str(input?.why) || undefined;
  const ops: MapOp[] = [];
  const refused: string[] = [];

  // Each op is tried against the map as the ones before it leave it, so one call can
  // add a region and place fields into it.
  const attempt = (label: string, build: (map: WorldMap) => MapOp) => {
    try {
      const op = build(map!);
      map = applyMapOp(map, op);
      ops.push(op);
    } catch (err: any) {
      refused.push(`${label} — ${err?.message ?? 'refused'}`);
    }
  };
  const base = () => ({ id: newId(), status: 'pending' as const, why, domain });

  for (const raw of list(input?.addRegions)) {
    attempt(`add region "${str(raw?.name)}"`, () => {
      if (!str(raw?.name)) throw new ToolError('a region needs a name');
      return { ...base(), kind: 'map.region', action: 'add', region: { id: mapSlug(str(raw.name)), name: str(raw.name), description: str(raw?.description), x: unit(raw?.x), y: unit(raw?.y) } };
    });
  }
  for (const raw of list(input?.updateRegions)) {
    attempt(`update region "${str(raw?.region)}"`, (m) => {
      const before = regionOf(m, raw?.region);
      const region: MapRegion = {
        ...before,
        name: str(raw?.name) || before.name,
        description: str(raw?.description) || before.description,
        x: raw?.x === undefined ? before.x : unit(raw.x, before.x),
        y: raw?.y === undefined ? before.y : unit(raw.y, before.y),
      };
      if (JSON.stringify(region) === JSON.stringify(before)) throw new ToolError('nothing would change');
      return { ...base(), kind: 'map.region', action: 'update', region, before };
    });
  }
  for (const raw of list(input?.placements)) {
    attempt(`place "${str(raw?.field)}"`, (m) => {
      const region = regionOf(m, raw?.region);
      const wanted = str(raw?.field);
      const dataset = fields.find((f) => f.id === wanted || sameName(f.topic, wanted));
      const ghost = m.ghosts.find((g) => g.key === ghostKey(wanted));
      const fieldId = dataset?.id ?? ghost?.key;
      if (!fieldId) throw new ToolError(`not a dataset or proposed field of the ${domain} world`);
      const current = m.placements[fieldId]?.regionId;
      if (current === region.id) throw new ToolError(`already in ${region.name}`);
      return {
        ...base(), kind: 'map.place', fieldId, fieldName: dataset?.topic ?? ghost!.topic, regionId: region.id, regionName: region.name,
        beforeRegionName: m.regions.find((r) => r.id === current)?.name,
      };
    });
  }
  for (const raw of list(input?.addMissingFields)) {
    attempt(`propose field "${str(raw?.topic)}"`, (m) => {
      const topic = singleWordTopic(str(raw?.topic));
      if (!topic || !str(raw?.description)) throw new ToolError('topic and description are required');
      if (fields.some((f) => sameName(f.topic, topic))) throw new ToolError('a dataset of that name already exists');
      const region = regionOf(m, raw?.region);
      return { ...base(), kind: 'map.ghost', action: 'add', field: { topic, description: str(raw.description), why: str(raw?.why) }, regionId: region.id, regionName: region.name };
    });
  }
  for (const raw of list<string>(input?.removeMissingFields)) {
    attempt(`drop proposed field "${str(raw)}"`, (m) => {
      const ghost = m.ghosts.find((g) => g.key === ghostKey(str(raw)));
      if (!ghost) throw new ToolError('not a proposed field on this map');
      const { key: _key, regionId, ...field } = ghost;
      return { ...base(), kind: 'map.ghost', action: 'remove', field, regionId, regionName: m.regions.find((r) => r.id === regionId)?.name ?? '' };
    });
  }
  // Last, so a region emptied by the placements above can go in the same call.
  for (const raw of list<string>(input?.removeRegions)) {
    attempt(`remove region "${str(raw)}"`, (m) => ({ ...base(), kind: 'map.region', action: 'remove', region: regionOf(m, raw) }));
  }

  if (ops.length) await stage(ctx, ops, { [`map:${domain}`]: `The ${domain} map` });
  return [
    `Staged ${ops.length} change${ops.length === 1 ? '' : 's'} to the ${domain} map.`,
    refused.length ? `Refused ${refused.length}:\n${refused.map((r) => `- ${r}`).join('\n')}` : '',
    STAGED_NOTE,
  ].filter(Boolean).join('\n');
}

async function proposeDeleteDataset(ctx: ToolContext, input: any): Promise<string> {
  if (!str(input?.dataset)) throw new ToolError('Name the dataset to delete — this one never defaults to what the user is viewing.');
  const { ds } = await projected(ctx, input.dataset);
  if (ds.items.length) {
    throw new ToolError(`${ds.topic} still holds ${ds.items.length} items (counting what is already staged). Stage moving them elsewhere (propose_move_items) or removing them first; only an empty dataset can be deleted.`);
  }
  await stage(
    ctx,
    [{ id: newId(), kind: 'dataset.delete', status: 'pending', why: str(input?.why) || undefined, datasetId: ds.id, domain: ds.domain, topic: ds.topic }],
    { [ds.id]: ds.topic },
  );
  return `Staged deleting the (emptied) dataset ${ds.topic}.\n${STAGED_NOTE}`;
}

async function withdrawChanges(ctx: ToolContext, input: any): Promise<string> {
  const cs = await openChangeset(ctx.threadId);
  if (!cs) return 'Nothing is staged.';
  const ids = list<string>(input?.opIds);
  const next = await rejectOps(ctx.threadId, cs.id, ids);
  ctx.onChangeset(next);
  return `Withdrew ${ids.length} staged change(s).`;
}

// ---- Dispatch ----

const HANDLERS: Record<string, (ctx: ToolContext, input: any) => Promise<string>> = {
  list_datasets: listDatasetsTool,
  get_dataset: getDatasetTool,
  get_items: getItemsTool,
  search_items: searchItemsTool,
  get_world_map: getWorldMapTool,
  get_curation_rules: () => loadRules(),
  get_pending_changes: pendingChangesTool,
  get_item_reports: getItemReportsTool,
  propose_add_items: proposeAddItems,
  propose_update_items: proposeUpdateItems,
  propose_remove_items: proposeRemoveItems,
  propose_move_items: proposeMoveItems,
  propose_update_dataset: proposeUpdateDataset,
  propose_create_dataset: proposeCreateDataset,
  propose_delete_dataset: proposeDeleteDataset,
  propose_draw_map: proposeDrawMap,
  propose_map_changes: proposeMapChanges,
  withdraw_changes: withdrawChanges,
};

export async function runTool(ctx: ToolContext, name: string, input: unknown): Promise<ToolAnswer> {
  const handler = HANDLERS[name];
  if (!handler) return { text: `Unknown tool "${name}".`, isError: true };
  try {
    return { text: await handler(ctx, input ?? {}) };
  } catch (err: any) {
    // A ToolError is advice; anything else is a fault — either way Claude is told, so
    // it can adjust or tell the user, rather than the turn dying.
    if (!(err instanceof ToolError)) console.error(`[chat] tool ${name} failed:`, err);
    return { text: err?.message ?? 'The tool failed.', isError: true };
  }
}
