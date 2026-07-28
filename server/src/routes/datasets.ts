import { Router, type NextFunction, type Request, type Response } from 'express';
import { deleteDataset, getDataset, listDatasets, saveDataset } from '../storage.ts';
import { newId, now } from '../util.ts';
import { normalizeDomain, optionalDomain } from '../../../shared/types.ts';
import type { Dataset, Domain, EraGroup, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

export const datasetsRouter = Router();

/**
 * Let the browser reuse a dataset response instead of re-fetching it.
 *
 * `max-age` is short because you edit datasets in-app and expect to see it; the real
 * saving is the ETag Express attaches to every JSON body — after the max-age lapses
 * the browser re-validates and almost always gets an empty 304 back, so a revisit
 * costs a few hundred bytes rather than the whole dataset. `private` keeps it in the
 * user's own cache only, never a shared proxy's.
 */
function cacheable(res: Response, seconds: number): void {
  res.set('Cache-Control', `private, max-age=${seconds}, stale-while-revalidate=300`);
}

function toItem(raw: Partial<Item> & Partial<ProposedItem>): Item {
  return {
    id: (raw as Item).id || newId(),
    name: raw.name ?? '',
    description: raw.description ?? '',
    image: raw.image ?? '',
    year: raw.year ?? null,
    brand: raw.brand ?? '',
    creator: raw.creator ?? '',
    definingFact: raw.definingFact ?? '',
    subtopic: raw.subtopic ?? '',
    url: raw.url ?? '',
    createdAt: (raw as Item).createdAt || now(),
  };
}

datasetsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // optionalDomain accepts the legacy hardware/software spellings too, so a client
    // that hasn't reloaded since the rename still gets the right shelf.
    const summaries = await listDatasets(optionalDomain(req.query.domain));
    // Set only once the read succeeded — a header applied before the await would
    // still be attached if it threw, telling the browser to cache a 500.
    cacheable(res, 30);
    res.json(summaries);
  } catch (err) { next(err); }
});

datasetsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    cacheable(res, 30);
    res.json(ds);
  } catch (err) { next(err); }
});

datasetsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { topic, description, subtopics, eraGroups, items, domain } = req.body as {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      eraGroups?: EraGroup[];
      items: ProposedItem[];
      domain: Domain;
    };
    if (!topic?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'topic and description are required' });
    }
    const ds: Dataset = {
      id: newId(),
      domain: normalizeDomain(domain),
      topic: topic.trim(),
      description: description.trim(),
      subtopics: subtopics ?? [],
      eraGroups: eraGroups ?? [],
      items: (items ?? []).map(toItem),
      createdAt: now(),
      updatedAt: now(),
    };
    res.status(201).json(await saveDataset(ds));
  } catch (err) { next(err); }
});

datasetsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await getDataset(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Dataset not found' });
    const body = req.body as Partial<Dataset>;
    const ds: Dataset = {
      ...existing,
      topic: body.topic?.trim() || existing.topic,
      description: body.description?.trim() || existing.description,
      subtopics: body.subtopics ?? existing.subtopics,
      eraGroups: body.eraGroups ?? existing.eraGroups,
      items: (body.items ?? existing.items).map(toItem),
    };
    res.json(await saveDataset(ds));
  } catch (err) { next(err); }
});

datasetsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteDataset(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
