import { Router, type NextFunction, type Request, type Response } from 'express';
import { getDataset, saveDataset } from '../storage.ts';
import { mergeLikes } from '../services/tweets.ts';
import type { LikedTweetRef } from '../../../shared/types.ts';

export const tweetsRouter = Router();

/** Per request. The browser splits a whole like.js into batches this size, so no one
 *  request outlives a proxy timeout and an interrupted import loses one batch at most. */
const MAX_BATCH = 50;

// Fold a batch of liked tweets into one of your personal datasets
// (services/tweets.ts). Saved per batch, and re-importing skips what's already there,
// so the same file can simply be imported again to resume or to retry failures.
tweetsRouter.post('/import', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { datasetId, likes } = req.body as { datasetId?: string; likes?: LikedTweetRef[] };
    const refs = (Array.isArray(likes) ? likes : [])
      .map((l) => ({ id: String(l?.id ?? ''), text: typeof l?.text === 'string' ? l.text : undefined }))
      .filter((l) => /^\d{1,25}$/.test(l.id));
    if (!datasetId || !refs.length) {
      return res.status(400).json({ error: 'datasetId and at least one tweet id are required' });
    }
    if (refs.length > MAX_BATCH) {
      return res.status(400).json({ error: `At most ${MAX_BATCH} tweets per request.` });
    }
    const ds = await getDataset(datasetId);
    // Tweets are your own reading history, so they only ever go in your own world.
    if (!ds || ds.domain !== 'personal') {
      return res.status(404).json({ error: 'Personal dataset not found' });
    }
    const { dataset, stats } = await mergeLikes(ds, refs);
    const changed = stats.added + stats.merged + stats.unavailable > 0;
    res.json({ dataset: changed ? await saveDataset(dataset) : ds, stats });
  } catch (err) { next(err); }
});
