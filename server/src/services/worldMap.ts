// Merging a review's map proposal into the stored map (8-field-map.md).
//
// This module is where the map's central promise is actually kept. The prompt asks
// the model to leave a settled map alone, but a prompt is a request. The guarantee is
// here: when a map exists, the merge takes ONLY new placements and suggestions out of
// a response, and never axes or regions. A model that ignores the instruction, or a
// future model that reads it differently, still cannot scramble a map you've learned.
//
// The other half of the promise is that the merge is *additive*: a field already on the
// map keeps the region it's in. Change reaches the map only through a suggestion you
// accept.
import { mapSlug, type Domain } from '../../../shared/types.ts';
import type {
  FieldMapReview,
  GhostField,
  MapRegion,
  MapSuggestion,
  Placement,
  WorldMap,
} from '../../../shared/types.ts';
import type { MapProposal } from './claude.ts';
import { now } from '../util.ts';

/** A dataset as the merge needs to see it: its id, and the topic the model refers to it by. */
export interface MapField {
  id: string;
  topic: string;
}

const FALLBACK_AXES: WorldMap['axes'] = {
  x: { label: 'Scale', low: 'small', high: 'large' },
  y: { label: 'Character', low: 'practical', high: 'expressive' },
};

/** An empty map for a world that has never been reviewed. */
function blankMap(domain: Domain): WorldMap {
  return {
    domain,
    axes: FALLBACK_AXES,
    regions: [],
    placements: {},
    ghosts: [],
    suggestions: [],
    updatedAt: now(),
  };
}

/**
 * Fold a review into the stored map.
 *
 * Returns a new map; never mutates the one passed in. `fields` supplies the topic→id
 * mapping the model's name-based answers are resolved through.
 */
export function mergeProposal(args: {
  domain: Domain;
  existing: WorldMap | null;
  review: FieldMapReview;
  proposal: MapProposal;
  fields: MapField[];
}): WorldMap {
  const { domain, existing, review, proposal, fields } = args;
  const base = existing ?? blankMap(domain);
  const isNew = !existing;

  // --- Regions and axes: taken from the model on a first draw, frozen thereafter ---
  const regions: MapRegion[] = isNew
    ? proposal.regions.map((r) => ({ id: mapSlug(r.name), ...r }))
    : base.regions;
  const axes = isNew ? proposal.axes ?? base.axes : base.axes;

  if (!regions.length) {
    // Nothing to place things into. Return the base untouched rather than writing a
    // map with no regions, which would render as an empty canvas and look like data loss.
    return { ...base, suggestions: base.suggestions, updatedAt: now() };
  }

  const byId = new Map(regions.map((r) => [r.id, r]));
  const idForName = new Map(regions.map((r) => [r.name.toLowerCase(), r.id]));
  const resolveRegion = (name: string): string | null =>
    idForName.get(name.trim().toLowerCase()) ?? null;

  const idForTopic = new Map(fields.map((f) => [f.topic.toLowerCase(), f.id]));
  const assignedRegion = new Map<string, string>();
  for (const a of proposal.assignments) {
    const regionId = resolveRegion(a.region);
    if (regionId) assignedRegion.set(a.field.toLowerCase(), regionId);
  }

  // A region every unresolvable thing can still land in, so nothing silently vanishes
  // off the canvas because the model named a region slightly differently.
  const fallbackRegion = regions[0].id;

  // --- Placements: additive. An existing placement is never overwritten here ---
  const placements: Record<string, Placement> = { ...base.placements };

  for (const f of fields) {
    const current = placements[f.id];
    if (current && byId.has(current.regionId)) continue; // already on the map, leave it
    placements[f.id] = {
      regionId: assignedRegion.get(f.topic.toLowerCase()) ?? fallbackRegion,
    };
  }

  // --- Ghosts: the proposed fields, as holes in their region ---
  const ghosts: GhostField[] = review.missingFields.map((m) => ({
    ...m,
    key: `ghost:${mapSlug(m.topic)}`,
    regionId: assignedRegion.get(m.topic.toLowerCase()) ?? fallbackRegion,
  }));

  for (const g of ghosts) {
    const current = placements[g.key];
    if (current && byId.has(current.regionId)) continue;
    placements[g.key] = { regionId: g.regionId };
  }

  // Drop placements for things that no longer exist — a deleted dataset, or a ghost
  // that has since been curated into a real field.
  const live = new Set<string>([...fields.map((f) => f.id), ...ghosts.map((g) => g.key)]);
  for (const key of Object.keys(placements)) {
    if (!live.has(key)) delete placements[key];
  }

  // --- Suggestions: resolved to ids, and only ones that still make sense ---
  const suggestions: MapSuggestion[] = proposal.suggestions
    .map((s, i): MapSuggestion | null => {
      const id = `${s.kind}:${i}:${mapSlug(s.why).slice(0, 24)}`;
      switch (s.kind) {
        case 'add-region': {
          const regionId = mapSlug(s.region.name);
          // Already there under that name — nothing to propose.
          if (byId.has(regionId)) return null;
          return { id, kind: 'add-region', why: s.why, region: { id: regionId, ...s.region } };
        }
        case 'move-field': {
          const datasetId = idForTopic.get(s.field.toLowerCase());
          const toRegionId = resolveRegion(s.toRegion);
          if (!datasetId || !toRegionId) return null;
          // Don't offer to move something to where it already is.
          const current = placements[datasetId];
          if (!current || current.regionId === toRegionId) return null;
          return { id, kind: 'move-field', why: s.why, datasetId, toRegionId };
        }
        case 'rename-region': {
          const regionId = resolveRegion(s.region);
          if (!regionId || !s.name.trim()) return null;
          return { id, kind: 'rename-region', why: s.why, regionId, name: s.name.trim() };
        }
      }
    })
    .filter((s): s is MapSuggestion => !!s);

  return { domain, axes, regions, placements, ghosts, suggestions, updatedAt: now() };
}

/** Apply one accepted suggestion. Returns a new map; unknown ids are a no-op. */
export function applySuggestion(map: WorldMap, suggestionId: string): WorldMap {
  const suggestion = map.suggestions.find((s) => s.id === suggestionId);
  if (!suggestion) return map;

  const rest = map.suggestions.filter((s) => s.id !== suggestionId);

  switch (suggestion.kind) {
    case 'add-region':
      return {
        ...map,
        regions: [...map.regions, suggestion.region],
        suggestions: rest,
        updatedAt: now(),
      };
    case 'move-field': {
      if (!map.placements[suggestion.datasetId]) return { ...map, suggestions: rest, updatedAt: now() };
      return {
        ...map,
        placements: {
          ...map.placements,
          [suggestion.datasetId]: { regionId: suggestion.toRegionId },
        },
        suggestions: rest,
        updatedAt: now(),
      };
    }
    case 'rename-region':
      return {
        ...map,
        regions: map.regions.map((r) =>
          r.id === suggestion.regionId ? { ...r, name: suggestion.name } : r,
        ),
        suggestions: rest,
        updatedAt: now(),
      };
  }
}

/** Dismiss a suggestion without applying it. */
export function dismissSuggestion(map: WorldMap, suggestionId: string): WorldMap {
  return {
    ...map,
    suggestions: map.suggestions.filter((s) => s.id !== suggestionId),
    updatedAt: now(),
  };
}

/**
 * Hand a newly-curated dataset the placement of the ghost it fulfils, so a field you
 * built because you saw the hole appears exactly where the hole was.
 * Returns null when nothing matched, so callers can skip the write.
 */
export function absorbGhost(map: WorldMap, datasetId: string, topic: string): WorldMap | null {
  const key = `ghost:${mapSlug(topic)}`;
  const ghostPlacement = map.placements[key];
  if (!ghostPlacement) return null;

  const placements = { ...map.placements, [datasetId]: { ...ghostPlacement } };
  delete placements[key];

  return {
    ...map,
    placements,
    ghosts: map.ghosts.filter((g) => g.key !== key),
    updatedAt: now(),
  };
}
