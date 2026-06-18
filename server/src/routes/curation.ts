import { Router } from 'express';
import { findGaps, generateItems, proposeSubtopics } from '../services/claude.ts';
import { wikimediaImage } from '../services/images.ts';
import type { Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

export const curationRouter = Router();

// Step 2: propose canonical subtopics for a new topic.
curationRouter.post('/subtopics', async (req, res) => {
  try {
    const { topic, description } = req.body as { topic: string; description: string };
    if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
    const subtopics = await proposeSubtopics(topic.trim(), description?.trim() ?? '');
    res.json({ subtopics });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Subtopic proposal failed' });
  }
});

// Step 3: generate items, then fetch a Wikimedia lead image for each.
curationRouter.post('/items', async (req, res) => {
  try {
    const { topic, description, subtopics, count, existingItems } = req.body as {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      count: number;
      existingItems?: Item[];
    };
    if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

    const proposed = await generateItems({
      topic: topic.trim(),
      description: description?.trim() ?? '',
      subtopics: subtopics ?? [],
      count: Math.max(1, Math.min(50, Number(count) || 12)),
      existingItems: existingItems ?? [],
    });

    // Resolve images in parallel; leave "" (needs image) when none found.
    const withImages: ProposedItem[] = await Promise.all(
      proposed.map(async (it) => ({
        ...it,
        image: await wikimediaImage(it.wikipediaTitle),
      })),
    );

    res.json({ items: withImages });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Item generation failed' });
  }
});

// "What's missing?" — breadth-first coverage sweep.
curationRouter.post('/gaps', async (req, res) => {
  try {
    const { topic, description, subtopics, items } = req.body as {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      items: Item[];
    };
    if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
    const gaps = await findGaps({
      topic: topic.trim(),
      description: description?.trim() ?? '',
      subtopics: subtopics ?? [],
      items: items ?? [],
    });
    res.json({ gaps });
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? 'Gap analysis failed' });
  }
});
