import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDataset } from '../storage.ts';
import type { EmbedDataset } from '../../../shared/types.ts';

export const embedRouter = Router();

/**
 * Public and cross-origin by design (this is fetched from whatever third-party page
 * embeds the widget), so — unlike datasets.ts's `cacheable` — this is `public`, not
 * `private`, and lives longer: an embed is a "set it and forget it" picture frame,
 * not something you're actively editing.
 */
function cacheable(res: Response, seconds: number): void {
  res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=3600`);
}

embedRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await getDataset(req.params.id);
    // 404, not 401: unlike datasets.ts (which tells a signed-out visitor a personal
    // dataset exists but needs sign-in), this endpoint is reachable by anyone with the
    // link, so it must not confirm a personal dataset's existence at all.
    if (!ds || ds.domain === 'personal') {
      return res.status(404).json({ error: 'Dataset not found' });
    }
    const body: EmbedDataset = {
      id: ds.id,
      topic: ds.topic,
      description: ds.description,
      items: ds.items.map((it) => ({
        id: it.id,
        name: it.name,
        image: it.image,
        year: it.year,
        brand: it.brand,
      })),
    };
    cacheable(res, 300);
    res.json(body);
  } catch (err) { next(err); }
});
