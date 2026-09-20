// Changesets: the approval gate between Claude and the data (shared/chat.ts).
//
// Claude never writes a dataset. Its propose_* tools (services/agentTools.ts) stage ops
// here; the user sees them as a diff and accepts some, all or none; only `applyChangeset`
// touches taste_datasets — and it records how to undo what it did.
//
// One function, `applyOp`, defines what each op MEANS, and it is used three ways:
//   - to PROJECT the pending ops onto a scratch copy, so a new proposal is validated
//     against the data as it will be (an item filed under a subtopic the same changeset
//     adds is fine; a second copy of an item it already adds is not);
//   - to APPLY accepted ops for real;
//   - and its undo records drive REVERT.
// Validation that is advice to Claude lives in the tools; what is here is what must
// hold for a write to be safe.
import {
  deleteDataset,
  getChangeset,
  getDataset,
  getWorldMap,
  listChangesets,
  saveChangeset,
  saveDataset,
  saveWorldMap,
} from '../storage.ts';
import { absorbGhost, applyMapOp, blankMap, removePlacement } from './worldMap.ts';
import { canonicalSubtopic } from './itemHygiene.ts';
import { newId, now } from '../util.ts';
import { singleWordTopic, slugifyTopic } from '../../../shared/types.ts';
import type { Dataset, Domain, Item, WorldMap } from '../../../shared/types.ts';
import {
  ITEM_PATCH_KEYS,
  changesetStatusOf,
  isMapOp,
  type ChangeOp,
  type Changeset,
  type ChangesetResult,
  type DatasetPatch,
  type ItemPatch,
  type UndoRecord,
} from '../../../shared/chat.ts';

/** Scratch copies of the datasets an operation touches, keyed by id. Always clones:
 *  `getDataset` hands back the storage cache's own object, which must never be mutated. */
export type Workspace = Map<string, Dataset>;

class OpError extends Error {
  constructor(public status: 'conflict' | 'failed', message: string) {
    super(message);
  }
}

// ---- Serialising writes ----
//
// A changeset row is read-modify-written from several places at once: Claude staging
// ops (possibly several tool calls in parallel), the image pipeline filling pictures in
// behind it, the user accepting. Every mutation goes through this per-thread queue and
// re-reads the row inside it, so none of them can write over another.
const chains = new Map<string, Promise<unknown>>();

export function locked<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(threadId) ?? Promise.resolve()).then(fn, fn);
  chains.set(threadId, next.catch(() => {}));
  return next;
}

// ---- Reading ----

export async function openChangeset(threadId: string): Promise<Changeset | null> {
  const all = await listChangesets(threadId);
  return all.find((c) => c.status === 'open') ?? null;
}

function datasetIdsOf(ops: ChangeOp[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    if (isMapOp(op)) continue;
    if (op.kind !== 'dataset.create') ids.add(op.datasetId);
    if (op.kind === 'item.move') ids.add(op.toDatasetId);
  }
  return [...ids];
}

async function loadWorkspace(ids: string[]): Promise<Workspace> {
  const ws: Workspace = new Map();
  await Promise.all(
    ids.map(async (id) => {
      const ds = await getDataset(id);
      if (ds) ws.set(ds.id, structuredClone(ds));
    }),
  );
  return ws;
}

/** The data as it would be if every pending op were accepted. Ops that can't apply are
 *  skipped — a projection is a best guess for validating the NEXT proposal, not a write. */
export async function project(cs: Changeset | null, extraDatasetIds: string[] = []): Promise<Workspace> {
  const pending = (cs?.ops ?? []).filter((o) => o.status === 'pending');
  const ws = await loadWorkspace([...new Set([...datasetIdsOf(pending), ...extraDatasetIds])]);
  for (const op of pending) {
    try {
      applyOp(ws, op, true);
    } catch {
      /* see above */
    }
  }
  return ws;
}

/** A world's map as it would be if every pending map op were accepted — what the next
 *  map proposal is validated against. Same best-guess rule as `project`. */
export async function projectMap(cs: Changeset | null, domain: Domain): Promise<WorldMap | null> {
  let map = await getWorldMap(domain);
  for (const op of cs?.ops ?? []) {
    if (op.status !== 'pending' || !isMapOp(op) || op.domain !== domain) continue;
    try {
      map = applyMapOp(map, op);
    } catch {
      /* see `project` */
    }
  }
  return map && map.regions.length ? map : null;
}

// ---- What each op means ----

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function requireDataset(ws: Workspace, id: string): Dataset {
  const ds = ws.get(id);
  if (!ds) throw new OpError('failed', 'That dataset no longer exists.');
  return ds;
}

function requireItem(ds: Dataset, itemId: string): { item: Item; index: number } {
  const index = ds.items.findIndex((i) => i.id === itemId);
  if (index === -1) throw new OpError('failed', `That item is no longer in ${ds.topic}.`);
  return { item: ds.items[index], index };
}

/** Apply one op to the workspace and say how to undo it. Throws OpError when it can't:
 *  'conflict' if the data moved since the op was staged (skipped under `force`),
 *  'failed' if there is nothing left to apply it to. */
export function applyOp(ws: Workspace, op: ChangeOp, force = false): UndoRecord {
  switch (op.kind) {
    case 'item.add': {
      const ds = requireDataset(ws, op.datasetId);
      if (ds.items.some((i) => i.id === op.item.id)) throw new OpError('failed', 'Already added.');
      // `candidates` is review-time baggage (the alternative pictures), never saved.
      const { candidates: _candidates, ...fields } = op.item;
      ds.items.push({
        ...fields,
        url: fields.url ?? '',
        image: fields.image ?? '',
        subtopic: canonicalSubtopic(fields.subtopic ?? '', ds.subtopics),
        createdAt: now(),
      });
      return { opId: op.id, kind: 'item.add', datasetId: ds.id, itemId: op.item.id };
    }

    case 'item.update': {
      const ds = requireDataset(ws, op.datasetId);
      const { item } = requireItem(ds, op.itemId);
      const before: ItemPatch = {};
      for (const key of ITEM_PATCH_KEYS) {
        if (!(key in op.patch)) continue;
        if (!force && !same(item[key], op.before[key])) {
          throw new OpError('conflict', `"${item.name}" was edited after Claude proposed this (${key} changed).`);
        }
        (before as any)[key] = item[key] ?? null;
        (item as any)[key] = op.patch[key];
      }
      if ('subtopic' in op.patch) item.subtopic = canonicalSubtopic(item.subtopic, ds.subtopics);
      return { opId: op.id, kind: 'item.update', datasetId: ds.id, itemId: item.id, before };
    }

    case 'item.remove': {
      const ds = requireDataset(ws, op.datasetId);
      const { item, index } = requireItem(ds, op.itemId);
      ds.items.splice(index, 1);
      return { opId: op.id, kind: 'item.remove', datasetId: ds.id, item, index };
    }

    case 'item.move': {
      const from = requireDataset(ws, op.datasetId);
      const to = requireDataset(ws, op.toDatasetId);
      const { item, index } = requireItem(from, op.itemId);
      from.items.splice(index, 1);
      const beforeSubtopic = item.subtopic;
      to.items.push({ ...item, subtopic: canonicalSubtopic(op.subtopic, to.subtopics) });
      return {
        opId: op.id, kind: 'item.move', datasetId: from.id, toDatasetId: to.id,
        itemId: item.id, beforeSubtopic, index,
      };
    }

    case 'dataset.update': {
      const ds = requireDataset(ws, op.datasetId);
      const before: DatasetPatch = {};
      for (const key of ['topic', 'description', 'subtopics'] as const) {
        if (!(key in op.patch)) continue;
        if (!force && !same(ds[key], op.before[key])) {
          throw new OpError('conflict', `${ds.topic}'s ${key} changed after Claude proposed this.`);
        }
        (before as any)[key] = ds[key] ?? '';
        (ds as any)[key] = key === 'topic' ? singleWordTopic(op.patch.topic as string) : op.patch[key];
      }
      const itemSubtopics: Record<string, string> = {};
      for (const item of ds.items) {
        const renamed = op.renames?.[item.subtopic];
        if (renamed && renamed !== item.subtopic) {
          itemSubtopics[item.id] = item.subtopic;
          item.subtopic = renamed;
        }
      }
      return { opId: op.id, kind: 'dataset.update', datasetId: ds.id, before, itemSubtopics };
    }

    case 'dataset.create': {
      if (ws.has(op.datasetId)) throw new OpError('failed', 'Already created.');
      ws.set(op.datasetId, {
        id: op.datasetId,
        domain: op.domain,
        topic: singleWordTopic(op.topic),
        description: op.description,
        subtopics: op.subtopics,
        items: [],
        createdAt: now(),
        updatedAt: now(),
      });
      return { opId: op.id, kind: 'dataset.create', datasetId: op.datasetId };
    }

    case 'dataset.delete': {
      const ds = requireDataset(ws, op.datasetId);
      // Never a way to lose items: they are moved or removed first, as ops of their own
      // that the user saw and accepted.
      if (ds.items.length) {
        throw new OpError('failed', `${ds.topic} still holds ${ds.items.length} item${ds.items.length === 1 ? '' : 's'} — move or remove them first.`);
      }
      ws.delete(ds.id);
      return { opId: op.id, kind: 'dataset.delete', datasetId: ds.id, dataset: ds };
    }

    default:
      // Map ops don't touch datasets — `applyChangeset` runs them through applyMapOp.
      throw new OpError('failed', 'Not a dataset change.');
  }
}

// ---- Staging (Claude's side) ----

/** Add ops to the thread's open changeset, creating it on first use. `topics` names
 *  every dataset the ops touch, for the diff's headings. */
export function stageOps(
  threadId: string,
  ops: ChangeOp[],
  topics: Record<string, string>,
): Promise<Changeset> {
  return locked(threadId, async () => {
    const cs: Changeset = (await openChangeset(threadId)) ?? {
      id: newId(),
      threadId,
      status: 'open',
      ops: [],
      datasetTopics: {},
      undo: [],
      createdAt: now(),
      updatedAt: now(),
    };
    cs.ops.push(...ops);
    Object.assign(cs.datasetTopics, topics);
    cs.status = changesetStatusOf(cs.ops);
    cs.updatedAt = now();
    await saveChangeset(cs);
    return cs;
  });
}

/** Patch staged ops in place — the image pipeline's way in (it finishes long after the
 *  op was staged, by which time the row may hold more ops than it saw). */
export function patchOps(
  threadId: string,
  changesetId: string,
  patch: (op: ChangeOp) => void,
): Promise<Changeset | null> {
  return locked(threadId, async () => {
    const cs = await getChangeset(changesetId);
    if (!cs) return null;
    cs.ops.forEach(patch);
    cs.updatedAt = now();
    await saveChangeset(cs);
    return cs;
  });
}

// ---- Deciding (the user's side) ----

function pick(cs: Changeset, opIds: string[] | undefined): ChangeOp[] {
  const wanted = opIds ? new Set(opIds) : null;
  return cs.ops.filter(
    (o) => (o.status === 'pending' || o.status === 'conflict') && (!wanted || wanted.has(o.id)),
  );
}

export function rejectOps(threadId: string, changesetId: string, opIds?: string[]): Promise<Changeset> {
  return locked(threadId, async () => {
    const cs = await getChangeset(changesetId);
    if (!cs) throw new Error('Changeset not found.');
    for (const op of pick(cs, opIds)) op.status = 'rejected';
    cs.status = changesetStatusOf(cs.ops);
    cs.updatedAt = now();
    await saveChangeset(cs);
    return cs;
  });
}

/**
 * Write the accepted ops. Ops are applied in the order Claude staged them, since that
 * is the order they were validated in (a field is created before items move into it).
 * Each op succeeds or fails on its own: accepting nine good changes must not be blocked
 * by a tenth whose item was deleted in the meantime.
 */
export function applyChangeset(
  threadId: string,
  changesetId: string,
  opts: { opIds?: string[]; force?: boolean } = {},
): Promise<ChangesetResult> {
  return locked(threadId, async () => {
    const cs = await getChangeset(changesetId);
    if (!cs) throw new Error('Changeset not found.');
    const selected = pick(cs, opts.opIds);
    const ws = await loadWorkspace(datasetIdsOf(selected));
    const slugBefore = new Map([...ws.values()].map((ds) => [ds.id, slugifyTopic(ds.topic)]));

    const touched = new Set<string>();
    const undos: UndoRecord[] = [];
    const deleted: Array<{ op: ChangeOp; id: string; slug: string; topic: string }> = [];

    // Maps are loaded up front and written once at the end, like datasets. The first
    // time a world's map is touched, the whole map is snapshotted as that op's undo.
    const maps = new Map<Domain, WorldMap | null>();
    const dirtyMaps = new Set<Domain>();
    for (const op of selected) {
      if ('domain' in op && !maps.has(op.domain)) maps.set(op.domain, await getWorldMap(op.domain).catch(() => null));
    }
    const snapshotted = new Set<Domain>();
    const writeMap = (opId: string, domain: Domain, next: WorldMap) => {
      if (!snapshotted.has(domain)) {
        snapshotted.add(domain);
        undos.push({ opId, kind: 'map', domain, before: maps.get(domain) ?? null });
      }
      maps.set(domain, next);
      dirtyMaps.add(domain);
    };

    for (const op of selected) {
      try {
        if (isMapOp(op)) {
          let next: WorldMap;
          try {
            next = applyMapOp(maps.get(op.domain) ?? null, op);
          } catch (err: any) {
            throw new OpError('failed', err?.message ?? 'The map has changed since this was proposed.');
          }
          writeMap(op.id, op.domain, next);
          op.status = 'applied';
          delete op.problem;
          continue;
        }
        // Dataset names are unique across the whole shelf (the slug column), and the
        // database's own complaint about that is not something to show anyone.
        const newTopic =
          op.kind === 'dataset.create' ? op.topic : op.kind === 'dataset.update' ? op.patch.topic : undefined;
        if (newTopic) {
          const clash = await getDataset(slugifyTopic(singleWordTopic(newTopic)));
          if (clash && clash.id !== op.datasetId) {
            throw new OpError('failed', `A dataset called ${clash.topic} already exists.`);
          }
        }
        const undo = applyOp(ws, op, opts.force === true);
        if (undo.kind === 'dataset.delete') {
          deleted.push({
            op,
            id: undo.datasetId,
            slug: slugBefore.get(undo.datasetId) ?? slugifyTopic(undo.dataset.topic),
            topic: undo.dataset.topic,
          });
          const map = maps.get(undo.dataset.domain);
          const without = map && removePlacement(map, undo.datasetId);
          if (map && without) {
            undo.regionId = map.placements[undo.datasetId]?.regionId;
            writeMap(op.id, undo.dataset.domain, without);
          }
        }
        undos.push(undo);
        op.status = 'applied';
        delete op.problem;
        touched.add(op.datasetId);
        if (op.kind === 'item.move') touched.add(op.toDatasetId);
      } catch (err: any) {
        op.status = err instanceof OpError ? err.status : 'failed';
        op.problem = err?.message ?? 'Could not be applied.';
      }
    }

    /** The write behind an op didn't happen after all: say so, and forget its undo. */
    const fail = (op: ChangeOp, problem: string) => {
      op.status = 'failed';
      op.problem = problem;
      for (let i = undos.length - 1; i >= 0; i -= 1) {
        if (undos[i].opId === op.id && undos[i].kind !== 'map') undos.splice(i, 1);
      }
    };

    const updated: Dataset[] = [];
    let saveFailed = false;
    for (const id of touched) {
      const ds = ws.get(id);
      if (!ds) continue;
      try {
        updated.push(await saveDataset(ds, slugBefore.get(id)));
      } catch (err: any) {
        // The write itself failed: nothing in this dataset actually changed.
        saveFailed = true;
        for (const op of selected) {
          if (isMapOp(op)) continue;
          const mine = op.datasetId === id || (op.kind === 'item.move' && op.toDatasetId === id);
          if (mine && op.status === 'applied') fail(op, err?.message ?? 'The save failed.');
        }
      }
    }

    // Deletions go last, and not at all if any save above failed: a dataset emptied by
    // moves must not disappear while its items' new home didn't get written.
    const deletedTopics: string[] = [];
    for (const d of deleted) {
      if (d.op.status !== 'applied') continue;
      if (saveFailed) {
        fail(d.op, 'Another save failed, so nothing was deleted.');
        continue;
      }
      try {
        await deleteDataset(d.id, d.slug);
        deletedTopics.push(d.topic);
      } catch (err: any) {
        fail(d.op, err?.message ?? 'The delete failed.');
      }
    }

    for (const domain of [...dirtyMaps]) {
      const map = maps.get(domain);
      try {
        if (map) await saveWorldMap(map);
      } catch (err: any) {
        for (const op of selected) {
          if (isMapOp(op) && op.domain === domain && op.status === 'applied') fail(op, err?.message ?? 'The map could not be saved.');
        }
        for (let i = undos.length - 1; i >= 0; i -= 1) {
          const u = undos[i];
          if (u.kind === 'map' && u.domain === domain) undos.splice(i, 1);
        }
        dirtyMaps.delete(domain);
      }
    }

    // A field built because the map showed a hole takes that hole's place — same
    // best-effort courtesy the manual create path pays (routes/datasets.ts).
    for (const op of selected) {
      if (op.kind !== 'dataset.create' || op.status !== 'applied') continue;
      try {
        const map = await getWorldMap(op.domain);
        const absorbed = map && absorbGhost(map, op.datasetId, singleWordTopic(op.topic));
        if (absorbed) {
          await saveWorldMap(absorbed);
          dirtyMaps.add(op.domain);
        }
      } catch { /* it still shows, in the map's first region, until it is placed */ }
    }

    cs.undo.push(...undos);
    for (const ds of updated) cs.datasetTopics[ds.id] = ds.topic;
    cs.status = changesetStatusOf(cs.ops);
    cs.updatedAt = now();
    await saveChangeset(cs);
    return { changeset: cs, updated, deletedTopics, maps: await currentMaps(dirtyMaps) };
  });
}

async function currentMaps(domains: Iterable<Domain>): Promise<WorldMap[]> {
  const maps = await Promise.all([...domains].map((d) => getWorldMap(d).catch(() => null)));
  return maps.filter((m): m is WorldMap => !!m);
}

/**
 * Put back everything this changeset applied, newest first. Best-effort by design: data
 * that has moved on since (an added item you then deleted by hand) is skipped rather
 * than failing the whole undo.
 */
export function revertChangeset(threadId: string, changesetId: string): Promise<ChangesetResult> {
  return locked(threadId, async () => {
    const cs = await getChangeset(changesetId);
    if (!cs) throw new Error('Changeset not found.');
    const records = [...cs.undo].reverse();
    const ids = new Set<string>();
    for (const u of records) {
      if (u.kind === 'map' || u.kind === 'dataset.delete') continue;
      ids.add(u.datasetId);
      if (u.kind === 'item.move') ids.add(u.toDatasetId);
    }
    const ws = await loadWorkspace([...ids]);
    const slugBefore = new Map([...ws.values()].map((ds) => [ds.id, slugifyTopic(ds.topic)]));
    const touched = new Set<string>();
    const created: string[] = [];
    const restoredMaps = new Set<Domain>();

    for (const u of records) {
      if (u.kind === 'map') {
        // Newest first, so the last one written for a world is its oldest snapshot.
        await saveWorldMap(structuredClone(u.before ?? blankMap(u.domain)));
        restoredMaps.add(u.domain);
        continue;
      }
      if (u.kind === 'dataset.delete') {
        // Put back only if the name hasn't been taken since.
        if (!(await getDataset(u.datasetId)) && !(await getDataset(slugifyTopic(u.dataset.topic)))) {
          ws.set(u.datasetId, structuredClone(u.dataset));
          touched.add(u.datasetId);
        }
        continue;
      }
      const ds = ws.get(u.datasetId);
      if (!ds) continue;
      touched.add(ds.id);
      switch (u.kind) {
        case 'item.add':
          ds.items = ds.items.filter((i) => i.id !== u.itemId);
          break;
        case 'item.update': {
          const item = ds.items.find((i) => i.id === u.itemId);
          if (item) Object.assign(item, u.before);
          break;
        }
        case 'item.remove':
          if (!ds.items.some((i) => i.id === u.item.id)) {
            ds.items.splice(Math.min(u.index, ds.items.length), 0, u.item);
          }
          break;
        case 'item.move': {
          const to = ws.get(u.toDatasetId);
          const index = to?.items.findIndex((i) => i.id === u.itemId) ?? -1;
          if (!to || index === -1) break;
          const [item] = to.items.splice(index, 1);
          ds.items.splice(Math.min(u.index, ds.items.length), 0, { ...item, subtopic: u.beforeSubtopic });
          touched.add(to.id);
          break;
        }
        case 'dataset.update':
          Object.assign(ds, u.before);
          for (const item of ds.items) {
            if (u.itemSubtopics[item.id] !== undefined) item.subtopic = u.itemSubtopics[item.id];
          }
          break;
        case 'dataset.create':
          created.push(ds.id);
          break;
      }
    }

    const updated: Dataset[] = [];
    const deletedTopics: string[] = [];
    for (const id of touched) {
      const ds = ws.get(id)!;
      // A dataset this changeset created goes again — unless it has since been given
      // items of its own, in which case deleting it would destroy work that isn't ours.
      if (created.includes(id) && ds.items.length === 0) {
        await deleteDataset(id, slugifyTopic(ds.topic));
        deletedTopics.push(ds.topic);
      } else {
        updated.push(await saveDataset(ds, slugBefore.get(id)));
      }
    }

    for (const op of cs.ops) if (op.status === 'applied') op.status = 'rejected';
    cs.undo = [];
    cs.status = changesetStatusOf(cs.ops, true);
    cs.updatedAt = now();
    await saveChangeset(cs);
    return { changeset: cs, updated, deletedTopics, maps: await currentMaps(restoredMaps) };
  });
}
