import { Router, type NextFunction, type Request, type Response } from 'express';
import { createItemReport, getDataset } from '../storage.ts';
import type { EmbedDataset } from '../../../shared/types.ts';

/** Long enough for a real note, short enough that this public, unauthenticated
 *  endpoint can't be used to stash arbitrary amounts of text. */
const REPORT_TEXT_MAX = 2000;

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
        description: it.description,
        definingFact: it.definingFact,
      })),
    };
    cacheable(res, 300);
    res.json(body);
  } catch (err) { next(err); }
});

/**
 * A viewer flips a picture (Embed.tsx's card flip) and flags something wrong with it —
 * public and unauthenticated, same reach as the GET above. Stored durably
 * (storage.ts#createItemReport) so the curator can review it later and point the
 * Claude agent at it (agentTools.ts#get_item_reports) to fix the dataset.
 */
embedRouter.post('/:id/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await getDataset(req.params.id);
    if (!ds || ds.domain === 'personal') {
      return res.status(404).json({ error: 'Dataset not found' });
    }
    const { itemId, text } = req.body as { itemId?: unknown; text?: unknown };
    const item = ds.items.find((i) => i.id === itemId);
    if (!item) return res.status(400).json({ error: 'Unknown item' });
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (!trimmed) return res.status(400).json({ error: 'Say what looks wrong first.' });
    if (trimmed.length > REPORT_TEXT_MAX) {
      return res.status(400).json({ error: `Keep it under ${REPORT_TEXT_MAX} characters.` });
    }
    await createItemReport({
      datasetId: ds.id,
      itemId: item.id,
      itemName: item.name,
      domain: ds.domain,
      text: trimmed,
    });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});
