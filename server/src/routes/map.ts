import { Router, type NextFunction, type Request, type Response } from 'express';
import { getWorldMap, saveWorldMap } from '../storage.ts';
import { applySuggestion, dismissSuggestion } from '../services/worldMap.ts';
import { normalizeDomain } from '../../../shared/types.ts';
import type { WorldMap } from '../../../shared/types.ts';

export const mapRouter = Router();

// Reading and editing a world's stored map (8-field-map.md). Generating it is the
// review's job (/api/curation/field-map); everything here is the map as an object you
// own — where you dragged things, and which of the review's suggestions you took.

mapRouter.get('/:domain', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const map = await getWorldMap(normalizeDomain(req.params.domain));
    // null is a normal answer: a world that has never been reviewed has no map, and
    // the shelf falls back to the grid rather than showing an empty canvas.
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
    res.json({ map });
  } catch (err) { next(err); }
});

/**
 * Edits to an existing map. Deliberately narrow: region and axis names, and accepting
 * or dismissing a suggestion. Regions themselves are added only by accepting a
 * suggestion, and axes only by the first review — so the client cannot quietly redraw a
 * map the same way the model isn't allowed to.
 *
 * Placements are not editable at all. Which region a field sits in is the review's
 * judgement, changed by accepting a suggestion; where it sits *within* that region is
 * derived by the layout. Neither is a thing the client gets to assert.
 */
mapRouter.put('/:domain', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const domain = normalizeDomain(req.params.domain);
    const existing = await getWorldMap(domain);
    if (!existing) return res.status(404).json({ error: 'This world has no map yet.' });

    const { regionNames, axes, accept, dismiss } = req.body as {
      regionNames?: Record<string, string>;
      axes?: WorldMap['axes'];
      accept?: string;
      dismiss?: string;
    };

    let map: WorldMap = existing;

    if (regionNames) {
      map = {
        ...map,
        regions: map.regions.map((r) =>
          regionNames[r.id]?.trim() ? { ...r, name: regionNames[r.id].trim() } : r,
        ),
      };
    }

    if (axes?.x?.label && axes?.y?.label) map = { ...map, axes };
    if (accept) map = applySuggestion(map, accept);
    if (dismiss) map = dismissSuggestion(map, dismiss);

    res.json({ map: await saveWorldMap(map) });
  } catch (err) { next(err); }
});
