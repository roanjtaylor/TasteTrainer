import { Router } from 'express';
import type { Response } from 'express';
import {
  fillGaps,
  findGaps,
  generateItems,
  proposePeriods,
  proposeSubtopics,
  reviewFieldMap,
} from '../services/claude.ts';
import { screenshotForYear, wikimediaImage } from '../services/images.ts';
import { cleanProposals } from '../services/itemHygiene.ts';
import { mergeProposal, type MapField } from '../services/worldMap.ts';
import { getDataset, getWorldMap, listDatasets, saveWorldMap } from '../storage.ts';
import { normalizeDomain } from '../../../shared/types.ts';
import type {
  CoverageGap,
  Domain,
  EraGroup,
  FieldSummary,
  Item,
  ProposedItem,
  Subtopic,
} from '../../../shared/types.ts';

/**
 * Resolve each proposed item's image — Wikimedia by wikipediaTitle in the physical
 * world, a Wayback/live screenshot by url+year in the digital one
 * (7-software-design.md).
 *
 * In the digital world the progress line names the OUTCOME per item, not just a
 * counter: "Stripe, 2015 → archived 2014" vs "→ no snapshot, used live site". The
 * live-site fallback is the failure that used to be invisible — it returns a valid
 * image, so nothing downstream could tell it apart from a real period capture. Now
 * you watch it happen, and the outcome is stored on the item.
 */
async function attachImages(
  proposed: ProposedItem[],
  domain: Domain,
  send: (event: 'progress' | 'done' | 'error', data: unknown) => void,
): Promise<ProposedItem[]> {
  let done = 0;
  return Promise.all(
    proposed.map(async (it) => {
      if (domain !== 'digital') {
        const image = await wikimediaImage(it.wikipediaTitle ?? '');
        done += 1;
        send('progress', { line: `Fetching images… ${done} of ${proposed.length}` });
        return { ...it, image };
      }

      const { image, capture } = await screenshotForYear(it.url ?? '', it.year);
      done += 1;
      const outcome = !image
        ? 'no screenshot'
        : capture?.kind === 'archived'
          ? `archived ${capture.year}`
          : 'no snapshot, used live site';
      send('progress', {
        line: `${done}/${proposed.length} · ${it.name}${it.year ? `, ${it.year}` : ''} → ${outcome}`,
      });
      return { ...it, image, capture };
    }),
  );
}

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
  const { topic, description, domain } = req.body as { topic: string; description: string; domain: Domain };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

  const send = sse(res);
  try {
    const { subtopics, suggestedCount } = await proposeSubtopics(
      topic.trim(),
      description?.trim() ?? '',
      normalizeDomain(domain),
      (line) => send('progress', { line }),
    );
    send('done', { subtopics, suggestedCount });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Subtopic proposal failed' });
  }
  res.end();
});

// Propose named era-periods for the time axis (used by the Era filter timeline, and
// generated at dataset creation). Input carries the items so the span can be read.
curationRouter.post('/periods', async (req, res) => {
  // `items` is optional: the curate flow now asks for periods BEFORE any items exist,
  // so they can steer generation (era-first). Saved datasets still pass their items so
  // the periods fit the span actually present.
  const { topic, description, items, domain } = req.body as {
    topic: string;
    description: string;
    items?: Item[];
    domain: Domain;
  };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

  const send = sse(res);
  try {
    const eraGroups = await proposePeriods(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        items: items ?? [],
        domain: normalizeDomain(domain),
      },
      (line) => send('progress', { line }),
    );
    send('done', { eraGroups });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Period proposal failed' });
  }
  res.end();
});

// Step 3: generate items, then fetch a Wikimedia lead image for each.
curationRouter.post('/items', async (req, res) => {
  const { topic, description, subtopics, count, existingItems, domain, eraGroups } = req.body as {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    count: number;
    existingItems?: Item[];
    domain: Domain;
    eraGroups?: EraGroup[];
  };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
  const dom: Domain = normalizeDomain(domain);

  const send = sse(res);
  try {
    const proposed = await generateItems(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        subtopics: subtopics ?? [],
        count: Math.max(1, Math.min(50, Number(count) || 12)),
        domain: dom,
        eraGroups: eraGroups ?? [],
        existingItems: existingItems ?? [],
      },
      (line) => send('progress', { line }),
    );

    // Resolve images in parallel; report each as it lands. Leave "" (needs image)
    // when none found.
    const withImages = await attachImages(proposed, dom, send);

    send('done', { items: withImages });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Item generation failed' });
  }
  res.end();
});

// "Check this world" — the field-map review, one level above /gaps: it audits the
// SHELF rather than the inside of one field (curation-rules.md §g).
//
// The inventory is assembled HERE, from storage, rather than posted by the client:
// the shelf listing the client holds has no subtopic names or year spans, and the
// review is only as good as those. Reading each dataset is a cache hit in the common
// case (storage.ts caches by id), and this runs on an explicit button press.
curationRouter.post('/field-map', async (req, res) => {
  const { domain: rawDomain, redraw } = req.body as { domain?: Domain; redraw?: boolean };
  const domain = normalizeDomain(rawDomain);

  const send = sse(res);
  try {
    send('progress', { line: 'Reading the shelf…' });
    const summaries = await listDatasets(domain);
    const fields: FieldSummary[] = [];
    const mapFields: MapField[] = [];
    for (const s of summaries) {
      const ds = await getDataset(s.id);
      if (!ds) continue;
      const years = (ds.items ?? [])
        .map((i) => i.year)
        .filter((y): y is number => typeof y === 'number');
      fields.push({
        topic: ds.topic,
        description: ds.description,
        subtopics: (ds.subtopics ?? []).map((st) => st.name),
        itemCount: (ds.items ?? []).length,
        yearRange: years.length ? { min: Math.min(...years), max: Math.max(...years) } : null,
      });
      mapFields.push({ id: ds.id, topic: ds.topic });
    }

    // The stored map goes IN so the review amends rather than redraws.
    //
    // `redraw` is the deliberate escape hatch from that. A map's axes and regions are
    // settled by its first draw and nothing else can change them wholesale — which is
    // the right default, and would be a trap without a way out: a first draw that
    // picked poor axes would otherwise be permanent. Asking for a redraw throws the
    // stored map away and starts over, losing the regions and every position.
    const stored = await getWorldMap(domain).catch(() => null);
    const existing = redraw ? null : stored;
    const { proposal, ...review } = await reviewFieldMap(
      { domain, fields, existingMap: existing },
      (line) => send('progress', { line }),
    );

    // Best-effort: a map that fails to save still leaves a usable review on screen,
    // which is the half that was there before the map existed.
    let map = null;
    try {
      send('progress', { line: 'Drawing the map…' });
      map = await saveWorldMap(
        mergeProposal({ domain, existing, review, proposal, fields: mapFields }),
      );
    } catch (mapErr: any) {
      send('progress', { line: `Map not saved: ${mapErr?.message ?? 'unknown error'}` });
    }

    send('done', { ...review, map });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Field-map review failed' });
  }
  res.end();
});

// "What's missing?" — breadth-first coverage sweep.
curationRouter.post('/gaps', async (req, res) => {
  const { topic, description, subtopics, items, domain, eraGroups } = req.body as {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    items: Item[];
    domain: Domain;
    eraGroups?: EraGroup[];
  };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });

  const send = sse(res);
  try {
    const { gaps, suggestedCount } = await findGaps(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        subtopics: subtopics ?? [],
        items: items ?? [],
        domain: normalizeDomain(domain),
        eraGroups: eraGroups ?? [],
      },
      (line) => send('progress', { line }),
    );
    send('done', { gaps, suggestedCount });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Gap analysis failed' });
  }
  res.end();
});

// "Add what's missing" — research NEW items targeting the reported gaps, weighing the
// user's own feedback, then fetch a Wikimedia lead image for each (same as /items).
// Returns the proposed items plus a `note` explaining how the feedback was handled.
curationRouter.post('/gap-fill', async (req, res) => {
  const { topic, description, subtopics, items, gaps, count, feedback, domain, eraGroups } =
    req.body as {
      topic: string;
      description: string;
      subtopics: Subtopic[];
      items: Item[];
      gaps: CoverageGap[];
      count: number;
      feedback: string;
      domain: Domain;
      eraGroups?: EraGroup[];
    };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
  const dom: Domain = normalizeDomain(domain);

  const send = sse(res);
  try {
    const { items: proposed, note } = await fillGaps(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        subtopics: subtopics ?? [],
        existingItems: items ?? [],
        gaps: gaps ?? [],
        count: Math.max(1, Math.min(50, Number(count) || 8)),
        feedback: feedback ?? '',
        domain: dom,
        eraGroups: eraGroups ?? [],
      },
      (line) => send('progress', { line }),
    );

    // Enforced before the images are fetched, not after: a repeat that gets dropped
    // here would otherwise cost a Wikimedia lookup or a Wayback capture on its way to
    // being thrown away.
    const { items: clean, duplicates, unsetSubtopics } = cleanProposals(
      proposed,
      items ?? [],
      subtopics ?? [],
    );
    if (duplicates) send('progress', { line: `Dropped ${duplicates} already in the set…` });

    const withImages = await attachImages(clean, dom, send);
    send('done', { items: withImages, note, duplicates, unsetSubtopics });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Gap fill failed' });
  }
  res.end();
});
