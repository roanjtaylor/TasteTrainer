import { Router, type NextFunction, type Request, type Response } from 'express';
import { getWorldMap } from '../storage.ts';
import { normalizeDomain } from '../../../shared/types.ts';

export const mapRouter = Router();

// Reading a world's stored map (8-field-map.md). It is only ever CHANGED by accepting
// a changeset Claude staged in the chat (services/changesets.ts, the `map.*` ops).

mapRouter.get('/:domain', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const map = await getWorldMap(normalizeDomain(req.params.domain));
    // null is a normal answer: a world whose map hasn't been drawn yet has none, and
    // the shelf falls back to the grid rather than showing an empty canvas.
    res.set('Cache-Control', 'private, max-age=15, stale-while-revalidate=120');
    res.json({ map });
  } catch (err) { next(err); }
});
