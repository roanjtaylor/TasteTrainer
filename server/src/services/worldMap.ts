// What each map op MEANS (8-field-map.md, shared/chat.ts's `MapOp`).
//
// The map is changed the same way everything else is: Claude proposes ops in the chat,
// the user accepts them in the diff (services/changesets.ts). This module is the pure
// half — one op in, a new map out — used both to PROJECT pending ops (so a placement
// into a region the same changeset adds validates) and to APPLY accepted ones.
//
// The map's central promise is kept structurally: nothing here runs unless the user
// accepted it, so a map you've learned never rearranges itself.
import { mapSlug, type Domain } from '../../../shared/types.ts';
import type { GhostField, Placement, WorldMap } from '../../../shared/types.ts';
import type { MapOp } from '../../../shared/chat.ts';
import { now } from '../util.ts';

const FALLBACK_AXES: WorldMap['axes'] = {
  x: { label: 'Scale', low: 'small', high: 'large' },
  y: { label: 'Character', low: 'practical', high: 'expressive' },
};

/** An empty map: no regions, which every screen reads as "this world has no map yet". */
export function blankMap(domain: Domain): WorldMap {
  return { domain, axes: FALLBACK_AXES, regions: [], placements: {}, ghosts: [], updatedAt: now() };
}

export const ghostKey = (topic: string) => `ghost:${mapSlug(topic)}`;

/** Apply one op. Returns a new map; never mutates the one passed in. Throws a plain
 *  Error, worded for the user, when the op no longer fits the map. */
export function applyMapOp(existing: WorldMap | null, op: MapOp): WorldMap {
  const map = existing ?? blankMap(op.domain);
  const hasRegion = (id: string) => map.regions.some((r) => r.id === id);

  switch (op.kind) {
    case 'map.draw': {
      if (!op.regions.length) throw new Error('A map needs at least one region.');
      const ids = new Set(op.regions.map((r) => r.id));
      const first = op.regions[0].id;
      const placements: Record<string, Placement> = {};
      for (const [fieldId, regionId] of Object.entries(op.assignments)) {
        placements[fieldId] = { regionId: ids.has(regionId) ? regionId : first };
      }
      // Proposed fields survive a redraw: they are advice about the world, not about
      // the old layout. One whose region is gone lands in the first region.
      const ghosts: GhostField[] = map.ghosts.map((g) => ({ ...g, regionId: ids.has(g.regionId) ? g.regionId : first }));
      for (const g of ghosts) placements[g.key] = { regionId: g.regionId };
      return { domain: op.domain, axes: op.axes, regions: op.regions, placements, ghosts, updatedAt: now() };
    }

    case 'map.region': {
      if (op.action === 'add') {
        if (hasRegion(op.region.id)) throw new Error(`The map already has a region called ${op.region.name}.`);
        return { ...map, regions: [...map.regions, op.region], updatedAt: now() };
      }
      if (!hasRegion(op.region.id)) throw new Error(`The region ${op.region.name} is no longer on the map.`);
      if (op.action === 'update') {
        return { ...map, regions: map.regions.map((r) => (r.id === op.region.id ? op.region : r)), updatedAt: now() };
      }
      const held = Object.values(map.placements).filter((p) => p.regionId === op.region.id).length;
      if (held) throw new Error(`${op.region.name} still holds ${held} field${held === 1 ? '' : 's'} — move them first.`);
      if (map.regions.length === 1) throw new Error('A map cannot lose its last region.');
      return { ...map, regions: map.regions.filter((r) => r.id !== op.region.id), updatedAt: now() };
    }

    case 'map.place': {
      if (!hasRegion(op.regionId)) throw new Error(`The region ${op.regionName} is no longer on the map.`);
      return {
        ...map,
        placements: { ...map.placements, [op.fieldId]: { regionId: op.regionId } },
        ghosts: map.ghosts.map((g) => (g.key === op.fieldId ? { ...g, regionId: op.regionId } : g)),
        updatedAt: now(),
      };
    }

    case 'map.ghost': {
      const key = ghostKey(op.field.topic);
      if (op.action === 'remove') {
        const placements = { ...map.placements };
        delete placements[key];
        return { ...map, placements, ghosts: map.ghosts.filter((g) => g.key !== key), updatedAt: now() };
      }
      if (!hasRegion(op.regionId)) throw new Error(`The region ${op.regionName} is no longer on the map.`);
      if (map.ghosts.some((g) => g.key === key)) throw new Error(`${op.field.topic} is already proposed on the map.`);
      return {
        ...map,
        ghosts: [...map.ghosts, { ...op.field, key, regionId: op.regionId }],
        placements: { ...map.placements, [key]: { regionId: op.regionId } },
        updatedAt: now(),
      };
    }
  }
}

/** Take a dataset off the map (it was deleted). Null when it wasn't on it. */
export function removePlacement(map: WorldMap, fieldId: string): WorldMap | null {
  if (!map.placements[fieldId]) return null;
  const placements = { ...map.placements };
  delete placements[fieldId];
  return { ...map, placements, updatedAt: now() };
}

/**
 * A newly-created dataset fulfils the proposed field of the same name: the hole goes,
 * and — unless the dataset was already placed somewhere on purpose — it appears exactly
 * where the hole was. Returns null when nothing matched, so callers can skip the write.
 */
export function absorbGhost(map: WorldMap, datasetId: string, topic: string): WorldMap | null {
  const key = ghostKey(topic);
  const ghostPlacement = map.placements[key];
  if (!ghostPlacement) return null;

  const placements = { ...map.placements, [datasetId]: map.placements[datasetId] ?? { ...ghostPlacement } };
  delete placements[key];

  return {
    ...map,
    placements,
    ghosts: map.ghosts.filter((g) => g.key !== key),
    updatedAt: now(),
  };
}
