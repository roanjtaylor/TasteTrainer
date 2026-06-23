import { Router, type NextFunction, type Request, type Response } from 'express';
import { deleteDataset, getDataset, listDatasets, saveDataset } from '../storage.ts';
import { newId, now } from '../util.ts';
import type { Dataset, EraGroup, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

export const datasetsRouter = Router();

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
    createdAt: (raw as Item).createdAt || now(),
  };
}

datasetsRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listDatasets());
  } catch (err) { next(err); }
});

datasetsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    res.json(ds);
  } catch (err) { next(err); }
});

datasetsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { topic, description, subtopics, eraGroups, items } = req.body as {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      eraGroups?: EraGroup[];
      items: ProposedItem[];
    };
    if (!topic?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'topic and description are required' });
    }
    const ds: Dataset = {
      id: newId(),
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
