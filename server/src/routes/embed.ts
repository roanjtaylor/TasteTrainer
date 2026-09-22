import { Router, type NextFunction, type Request, type Response } from 'express';
import { createItemReport, getDataset } from '../storage.ts';
import type { Dataset, EmbedDataset } from '../../../shared/types.ts';

/** Long enough for a real note, short enough that this public, unauthenticated
 *  endpoint can't be used to stash arbitrary amounts of text. */
const REPORT_TEXT_MAX = 2000;

export const embedRouter = Router();

/**
 * Cross-origin by design (this is fetched from whatever third-party page embeds the
 * widget) and longer-lived than datasets.ts's `cacheable`: an embed is a "set it and
 * forget it" picture frame, not something you're actively editing. Public for the
 * researched worlds; a personal dataset is `private` so no shared cache between the
 * signed-in viewer and the server ever holds a copy.
 */
function cacheable(res: Response, seconds: number, personal: boolean): void {
  res.set('Cache-Control', `${personal ? 'private' : 'public'}, max-age=${seconds}, stale-while-revalidate=3600`);
}

/**
 * The same wall the app itself applies (routes/datasets.ts): a personal dataset is
 * served only to a signed-in caller. The widget on a third-party page shows its own
 * sign-in form on this 401 (web/src/pages/Embed.tsx), and the rejection is never
 * cached so a stored 401 can't outlive the sign-in.
 */
async function loadForViewer(req: Request, res: Response): Promise<Dataset | null> {
  const ds = await getDataset(req.params.id);
  if (!ds) {
    res.status(404).json({ error: 'Dataset not found' });
    return null;
  }
  if (ds.domain === 'personal' && !req.user) {
    res.set('Cache-Control', 'no-store');
    res.status(401).json({ error: 'Sign in to view this collection.' });
    return null;
  }
  return ds;
}

embedRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await loadForViewer(req, res);
    if (!ds) return;
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
        ...(it.tweet ? { tweet: it.tweet } : {}),
      })),
    };
    cacheable(res, 300, ds.domain === 'personal');
    res.json(body);
  } catch (err) { next(err); }
});

/**
 * A viewer flips a picture (Embed.tsx's card flip) and flags something wrong with it —
 * same reach as the GET above. Stored durably (storage.ts#createItemReport) so the
 * curator can review it later and point the Claude agent at it
 * (agentTools.ts#get_item_reports) to fix the dataset.
 */
embedRouter.post('/:id/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await loadForViewer(req, res);
    if (!ds) return;
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
