import { Router } from 'express';
import type { Response } from 'express';
import { findGaps, generateItems, proposeSubtopics } from '../services/claude.ts';
import { wikimediaImage } from '../services/images.ts';
import type { Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

export const curationRouter = Router();

// These calls take ~15–25s and we want the UI to show live progress instead of a
// blackbox spinner. So each endpoint streams Server-Sent Events: `progress` lines
// as Claude's output arrives, then a single `done` (with the payload) or `error`.
// The client reads the stream with fetch + a ReadableStream reader (see web/lib/api).
function sse(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // No proxy buffering — we need each line to reach the browser as it's written.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  return (event: 'progress' | 'done' | 'error', data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
}

// Step 2: propose canonical subtopics for a new topic.
curationRouter.post('/subtopics', async (req, res) => {
  const { topic, description } = req.body as { topic: string; description: string };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

  const send = sse(res);
  try {
    const { subtopics, suggestedCount } = await proposeSubtopics(
      topic.trim(),
      description?.trim() ?? '',
      (line) => send('progress', { line }),
    );
    send('done', { subtopics, suggestedCount });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Subtopic proposal failed' });
  }
  res.end();
});

// Step 3: generate items, then fetch a Wikimedia lead image for each.
curationRouter.post('/items', async (req, res) => {
  const { topic, description, subtopics, count, existingItems } = req.body as {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    count: number;
    existingItems?: Item[];
  };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

  const send = sse(res);
  try {
    const proposed = await generateItems(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        subtopics: subtopics ?? [],
        count: Math.max(1, Math.min(50, Number(count) || 12)),
        existingItems: existingItems ?? [],
      },
      (line) => send('progress', { line }),
    );

    // Resolve images in parallel; report each as it lands. Leave "" (needs image)
    // when none found.
    let done = 0;
    const withImages: ProposedItem[] = await Promise.all(
      proposed.map(async (it) => {
        const image = await wikimediaImage(it.wikipediaTitle);
        done += 1;
        send('progress', { line: `Fetching images… ${done} of ${proposed.length}` });
        return { ...it, image };
      }),
    );

    send('done', { items: withImages });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Item generation failed' });
  }
  res.end();
});

// "What's missing?" — breadth-first coverage sweep.
curationRouter.post('/gaps', async (req, res) => {
  const { topic, description, subtopics, items } = req.body as {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    items: Item[];
  };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

  const send = sse(res);
  try {
    const gaps = await findGaps(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        subtopics: subtopics ?? [],
        items: items ?? [],
      },
      (line) => send('progress', { line }),
    );
    send('done', { gaps });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Gap analysis failed' });
  }
  res.end();
});
