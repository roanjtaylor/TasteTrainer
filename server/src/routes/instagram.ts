import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDataset, saveDataset } from '../storage.ts';
import { mergePosts } from '../services/instagram.ts';
import type { InstagramPostRef } from '../../../shared/types.ts';

export const instagramRouter = Router();

/** Per request. Nothing is fetched per post, so a batch is cheap — the cap is only so
 *  one request's body stays well inside the JSON limit (index.ts). */
const MAX_BATCH = 250;

// Fold a batch of liked/saved Instagram posts into one of your personal datasets
// (services/instagram.ts). Saved per batch; re-importing the same files merges rather
// than duplicates, so the import can simply be run again to resume.
instagramRouter.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { datasetId, posts } = req.body as { datasetId?: string; posts?: InstagramPostRef[] };
    const refs: InstagramPostRef[] = (Array.isArray(posts) ? posts : [])
      .filter((p) => p && typeof p.url === 'string')
      .map((p) => ({
        url: p.url,
        caption: typeof p.caption === 'string' ? p.caption : undefined,
        owner: typeof p.owner === 'string' ? p.owner : undefined,
        ownerName: typeof p.ownerName === 'string' ? p.ownerName : undefined,
        hashtags: Array.isArray(p.hashtags) ? p.hashtags.filter((h) => typeof h === 'string') : undefined,
        likedAt: typeof p.likedAt === 'number' ? p.likedAt : undefined,
        savedAt: typeof p.savedAt === 'number' ? p.savedAt : undefined,
      }));
    if (!datasetId || !refs.length) {
      return res.status(400).json({ error: 'datasetId and at least one post are required' });
    }
    if (refs.length > MAX_BATCH) {
      return res.status(400).json({ error: `At most ${MAX_BATCH} posts per request.` });
    }
    const ds = await getDataset(datasetId);
    // Your own likes and saves only ever go in your own world.
    if (!ds || ds.domain !== 'personal') {
      return res.status(404).json({ error: 'Personal dataset not found' });
    }
    const { dataset, stats } = mergePosts(ds, refs);
    const changed = stats.added + stats.merged > 0;
    res.json({ dataset: changed ? await saveDataset(dataset) : ds, stats });
  } catch (err) { next(err); }
});
