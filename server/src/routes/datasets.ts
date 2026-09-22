import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  deleteDataset,
  getDataset,
  getWorldMap,
  listDatasets,
  saveDataset,
  saveWorldMap,
} from '../storage.ts';
import { absorbGhost } from '../services/worldMap.ts';
import { canonicalSubtopic } from '../services/itemHygiene.ts';
import { removeFiles, storagePathsIn } from '../services/personalFiles.ts';
import { newId, now } from '../util.ts';
import { normalizeDomain, optionalDomain, slugifyTopic } from '../../../shared/types.ts';
import type { Dataset, Domain, Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

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

// `subtopics` is the field's canonical list: an item's subtopic is corrected to that
// spelling on the way in, so a "Portraits"/"portraits" drift can't produce an item the
// subtopic filter will never match. Values that aren't on the list at all are kept as
// they are — see canonicalSubtopic.
function toItem(raw: Partial<Item> & Partial<ProposedItem>, subtopics: Subtopic[]): Item {
  return {
    id: (raw as Item).id || newId(),
    name: raw.name ?? '',
    description: raw.description ?? '',
    image: raw.image ?? '',
    year: raw.year ?? null,
    brand: raw.brand ?? '',
    creator: raw.creator ?? '',
    definingFact: raw.definingFact ?? '',
    subtopic: canonicalSubtopic(raw.subtopic ?? '', subtopics),
    url: raw.url ?? '',
    // Kept so a screenshot that isn't period-accurate stays flagged after saving —
    // dropping it here would hide exactly the failure it exists to surface.
    capture: raw.capture,
    // The sourcing hints are persisted, not just used once: re-resolving a saved item
    // has to know that "IBM 3270" is a terminal and not a website, and re-deriving that
    // would mean another curation call. Absent on everything saved before this existed,
    // which inferImageKind() handles.
    imageKind: raw.imageKind,
    imageQuery: raw.imageQuery,
    wikipediaTitle: raw.wikipediaTitle,
    // A saved thread (services/tweets.ts). Carried through every save — an edit to the
    // item's subtopic must not cost it the tweets it is made of.
    tweet: (raw as Item).tweet,
    createdAt: (raw as Item).createdAt || now(),
  };
}

datasetsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // optionalDomain accepts the legacy hardware/software spellings too, so a client
    // that hasn't reloaded since the rename still gets the right shelf.
    const domain = optionalDomain(req.query.domain);
    const summaries = await listDatasets(domain);
    // A signed-out visitor sees every non-personal dataset, plus any personal one that
    // isn't marked private — only datasets explicitly walled off stay hidden.
    const visible = req.user ? summaries : summaries.filter((d) => d.domain !== 'personal' || !d.private);
    // Set only once the read succeeded — a header applied before the await would
    // still be attached if it threw, telling the browser to cache a 500.
    cacheable(res, 30);
    res.json(visible);
  } catch (err) { next(err); }
});

datasetsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    if (ds.domain === 'personal' && ds.private && !req.user) {
      return res.status(401).json({ error: 'Sign in to access your personal world.' });
    }
    cacheable(res, 30);
    res.json(ds);
  } catch (err) { next(err); }
});

datasetsRouter.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { topic, description, subtopics, items, domain } = req.body as {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      items: ProposedItem[];
      domain: Domain;
    };
    if (!topic?.trim() || !description?.trim()) {
      return res.status(400).json({ error: 'topic and description are required' });
    }
    if (normalizeDomain(domain) === 'personal' && !req.user) {
      return res.status(401).json({ error: 'Sign in to access your personal world.' });
    }
    // Names are unique across the shelf (the `slug` column's unique constraint —
    // global, not per world). Say so in words, with where the existing one lives,
    // rather than surfacing Postgres's "duplicate key value violates unique
    // constraint" — which is what a second research run of an already-saved field
    // hit when the user tried to save it.
    const existing = await getDataset(slugifyTopic(topic));
    if (existing) {
      return res.status(409).json({
        error:
          `A ${existing.topic} dataset already exists (${existing.items.length} items) — ` +
          `open it at /${existing.domain}/${slugifyTopic(existing.topic)}, or delete it first to replace it.`,
      });
    }
    const canonicalSubtopics = subtopics ?? [];
    const ds: Dataset = {
      id: newId(),
      domain: normalizeDomain(domain),
      topic: topic.trim(),
      description: description.trim(),
      subtopics: canonicalSubtopics,
      items: (items ?? []).map((it) => toItem(it, canonicalSubtopics)),
      createdAt: now(),
      updatedAt: now(),
    };
    const saved = await saveDataset(ds);

    // If this field was one of the map's proposed gaps, it inherits the ghost's spot —
    // so a field you built *because* you saw the hole appears exactly where the hole
    // was. Best-effort: never fail a save because the map couldn't be updated.
    try {
      const map = await getWorldMap(saved.domain);
      const absorbed = map && absorbGhost(map, saved.id, saved.topic);
      if (absorbed) await saveWorldMap(absorbed);
    } catch { /* the next review will place it */ }

    res.status(201).json(saved);
  } catch (err) { next(err); }
});

datasetsRouter.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await getDataset(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Dataset not found' });
    if (existing.domain === 'personal' && !req.user) {
      return res.status(401).json({ error: 'Sign in to access your personal world.' });
    }
    const body = req.body as Partial<Dataset>;
    // Items are canonicalised against the subtopic list they are being saved WITH, so
    // a PUT that renames the subtopics and rewrites the items in one go agrees with
    // itself.
    const subtopics = body.subtopics ?? existing.subtopics;
    const ds: Dataset = {
      ...existing,
      topic: body.topic?.trim() || existing.topic,
      description: body.description?.trim() || existing.description,
      subtopics,
      items: (body.items ?? existing.items).map((it) => toItem(it, subtopics)),
      private: body.private ?? existing.private,
    };
    // A topic edit is also a rename of the dataset's URL, so hand the old slug over
    // for invalidation (storage.saveDataset).
    const saved = await saveDataset(ds, slugifyTopic(existing.topic));
    // An uploaded file belongs to exactly one item, so once a save leaves nothing
    // pointing at it — the item was deleted, or its image swapped — it is unreachable
    // and would otherwise sit in the private bucket forever. After the save, never
    // before: a failed save must not have already destroyed the pictures.
    const kept = new Set(storagePathsIn(saved));
    await removeFiles(storagePathsIn(existing).filter((path) => !kept.has(path)));
    res.json(saved);
  } catch (err) { next(err); }
});

datasetsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Resolve first: the param may be a slug.
    const existing = await getDataset(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Dataset not found' });
    if (existing.domain === 'personal' && !req.user) {
      return res.status(401).json({ error: 'Sign in to access your personal world.' });
    }
    await deleteDataset(existing.id, slugifyTopic(existing.topic));
    res.status(204).end();
  } catch (err) { next(err); }
});
