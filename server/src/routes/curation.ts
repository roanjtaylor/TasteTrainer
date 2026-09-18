import { Router } from 'express';
import type { Response } from 'express';
import {
  fillGaps,
  findGaps,
  generateItems,
  planBoundaryFix,
  proposePeriods,
  proposeSubtopics,
  reviewFieldMap,
} from '../services/claude.ts';
import { mapWithLimit, resolveDigitalImage, resolvePhysicalImage } from '../services/imageResolvers.ts';
import { canonicalSubtopic, cleanProposals } from '../services/itemHygiene.ts';
import { mergeProposal, type MapField } from '../services/worldMap.ts';
import {
  createJob,
  deleteDataset,
  getDataset,
  getWorldMap,
  listDatasets,
  saveDataset,
  saveWorldMap,
  updateJob,
} from '../storage.ts';
import { newId, now } from '../util.ts';
import { isPeriodAccurate, normalizeDomain, slugifyTopic } from '../../../shared/types.ts';
import type {
  BoundaryIssue,
  BoundaryKind,
  CoverageGap,
  Dataset,
  Domain,
  EraGroup,
  FieldSummary,
  FillMode,
  Item,
  Job,
  ProposedItem,
  Subtopic,
} from '../../../shared/types.ts';

/**
 * Resolve each proposed item's image — a scored multi-source cascade either way
 * (services/imageResolvers.ts): `resolvePhysicalImage` for plain reference photos,
 * `resolveDigitalImage` for the render/screenshot-aware digital pipeline.
 *
 * The digital branch used to be a single strategy: screenshot this url at this year.
 * That is right for websites and structurally wrong for the rest of the world it was
 * applied to — pre-web software, OS shells, icons and typefaces have no url to capture,
 * so the model invented Wikipedia article urls and the pipeline screenshotted the
 * encyclopaedia page. Now `imageKind` picks the resolvers, several sources compete, and
 * every candidate is scored before one is chosen.
 *
 * The physical branch used to be a single blind guess: one Wikipedia lookup, and if that
 * came up empty, the #1 hit of an unscored image search — no candidates, no scoring,
 * exactly the gap that made the manual "swap image" flow (nine candidates, a human
 * picking) far more reliable than first-pass generation. It now runs the same scored
 * reference-source cascade digital already uses (`resolvePhysicalImage`), so a wrong-era
 * or wrong-model photo has competition instead of winning by being first.
 *
 * The progress line names the OUTCOME per item, not just a counter, and now includes
 * WHICH source won and how much it is trusted — because the characteristic failure here
 * is a plausible wrong image, not a missing one, and a fallback that reports nothing is
 * how 99 of 99 items ended up with third-party screenshots nobody noticed.
 */
async function attachImages(
  proposed: ProposedItem[],
  domain: Domain,
  send: (event: 'progress' | 'done' | 'error', data: unknown) => void,
): Promise<ProposedItem[]> {
  let done = 0;

  if (domain !== 'digital') {
    return mapWithLimit(proposed, IMAGE_CONCURRENCY, async (it) => {
      const { image, capture, candidates } = await resolvePhysicalImage({
        name: it.name,
        year: it.year,
        wikipediaTitle: it.wikipediaTitle,
        imageQuery: it.imageQuery,
      });
      done += 1;
      const outcome = !image
        ? 'no image found'
        : `${capture?.source ?? '?'}${capture?.confidence && capture.confidence !== 'high' ? ` (${capture.confidence})` : ''}`;
      send('progress', {
        line: `${done}/${proposed.length} · ${it.name}${it.year ? `, ${it.year}` : ''} → ${outcome}`,
      });
      // Alternatives ride along only when the pick isn't trustworthy, so the review
      // grid can offer a one-click swap without bloating every payload — same rule
      // the digital branch below already applies.
      const alternatives = capture?.confidence === 'high' ? undefined : candidates;
      return { ...it, image, capture, candidates: alternatives };
    });
  }

  return mapWithLimit(proposed, IMAGE_CONCURRENCY, async (it) => {
    const { image, capture, candidates } = await resolveDigitalImage({
      name: it.name,
      year: it.year,
      imageKind: it.imageKind,
      url: it.url,
      wikipediaTitle: it.wikipediaTitle,
      imageQuery: it.imageQuery,
    });

    done += 1;
    const outcome = !image
      ? 'no image found'
      : `${capture?.source ?? '?'}${capture?.year ? ` ${capture.year}` : ''}` +
        `${capture?.confidence && capture.confidence !== 'high' ? ` (${capture.confidence}: ${capture.note ?? 'check this one'})` : ''}`;
    send('progress', {
      line: `${done}/${proposed.length} · ${it.name}${it.year ? `, ${it.year}` : ''} → ${outcome}`,
    });

    // Alternatives ride along only when the pick isn't trustworthy, so the review grid
    // can offer a one-click swap without bloating every payload.
    const alternatives = capture?.confidence === 'high' ? undefined : candidates;
    return { ...it, image, capture, candidates: alternatives };
  });
}

/** How many items resolve at once. The old code fanned out over every item with an
 *  unbounded Promise.all; with several resolvers per item that becomes hundreds of
 *  simultaneous requests to Wikimedia and archive.org, which both throttle — and the
 *  browser renders queue behind a single slot regardless, so a wider fan-out bought
 *  nothing but 429s. */
const IMAGE_CONCURRENCY = 3;

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
  // The server is a persistent process (render.yaml) — a client that closes the tab
  // mid-request does NOT stop the Claude call or the work still in flight below,
  // only the connection carrying its progress. Without this listener, writing to
  // that dead socket emits an unhandled 'error' on `res`, which by default crashes
  // the whole Node process — taking down every OTHER request in flight with it.
  res.on('error', () => {});
  return (event: 'progress' | 'done' | 'error', data: unknown) => {
    if (res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* client is gone; the caller's work still runs to completion above */
    }
  };
}

/** Per-job write queues, so a `progress` write can never land AFTER the `done`/`error`
 *  write that follows it and silently flip a finished job back to looking unfinished —
 *  `updateJob` calls for one job always run in the order they were issued, never
 *  concurrently. Cleared once a job reaches a terminal state. */
const jobWriteChains = new Map<string, Promise<void>>();

/**
 * Wraps `sse()` for the two calls whose result needs to survive the browser closing
 * (items, gap-fill — see shared/types.ts's `Job`). Every event still streams to a
 * connected client exactly as before; this only ADDS a durable write alongside it, so
 * a client that's watching sees no difference at all.
 *
 * `progress` writes are throttled — `attachImages` below reports one line per item,
 * and writing every one of those to Supabase is not worth it for a line nobody but a
 * (currently disconnected) later session will ever read as "in progress". `done` and
 * `error` are never throttled.
 */
function jobSend(res: Response, job: Job) {
  const send = sse(res);
  let lastProgressWrite = 0;
  // A line that lands inside the throttle window isn't dropped — it's held and
  // written when the window closes (trailing write), so the row always ends up on the
  // LATEST line. Dropping it was how a resumed card sat on "Reaching Claude…" for
  // minutes: "Claude is researching the field…" arrives a few hundred ms after it and
  // was silently discarded, and nothing else came until the first token.
  let pendingLine: string | null = null;
  let trailingTimer: ReturnType<typeof setTimeout> | undefined;
  let finished = false;

  const enqueue = (fn: () => Promise<void>) => {
    const next = (jobWriteChains.get(job.id) ?? Promise.resolve()).then(fn).catch(() => {
      /* best-effort — a lost progress/result write here doesn't affect the live client,
         which already has the event via send() above */
    });
    jobWriteChains.set(job.id, next);
    return next;
  };

  // The live client learns the durable row's id from the FIRST progress line, not just
  // from `done` — so it can pair its own transient card with the durable one while
  // the call is still running (web/components/TaskNotifications.tsx). Before this,
  // both showed side by side, and the durable one's ✕ read as "dismiss the duplicate"
  // when it actually deleted the job — the result then had nowhere to land.
  send('progress', { line: 'Starting…', jobId: job.id });

  return (event: 'progress' | 'done' | 'error', data: unknown) => {
    send(event, event === 'progress' ? { ...(data as object), jobId: job.id } : data);
    if (event === 'progress') {
      if (finished) return;
      const line = (data as any).line as string;
      const now = Date.now();
      const wait = 1500 - (now - lastProgressWrite);
      if (wait > 0) {
        pendingLine = line;
        if (!trailingTimer) {
          trailingTimer = setTimeout(() => {
            trailingTimer = undefined;
            if (finished || pendingLine === null) return;
            const held = pendingLine;
            pendingLine = null;
            lastProgressWrite = Date.now();
            enqueue(() => updateJob(job.id, { progress: held }));
          }, wait);
        }
        return;
      }
      pendingLine = null;
      lastProgressWrite = now;
      enqueue(() => updateJob(job.id, { progress: line }));
    } else {
      // Terminal: a held progress line must not land after this and re-open the job.
      finished = true;
      pendingLine = null;
      if (trailingTimer) { clearTimeout(trailingTimer); trailingTimer = undefined; }
      const patch =
        event === 'done'
          ? { status: 'done' as const, result: data }
          : { status: 'error' as const, error: (data as any).error };
      enqueue(() => updateJob(job.id, patch).finally(() => jobWriteChains.delete(job.id)));
    }
  };
}

// Step 2: propose canonical subtopics for a new topic, and the field's era-periods
// alongside them — "map the field" is one step to the user, so it is one durable job.
//
// Durable like /items and /gap-fill below (see jobSend above): this used to be a
// plain `sse()` call, whose result only ever lived in the live stream — a refresh or
// a server restart mid-call lost it outright, with nothing in the notification gutter
// to resume or even show that it happened. Now it survives the same way.
curationRouter.post('/subtopics', async (req, res) => {
  const { topic, description, domain } = req.body as { topic: string; description: string; domain: Domain };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
  const dom: Domain = normalizeDomain(domain);

  const job = await createJob({
    id: newId(), domain: dom, kind: 'subtopics', status: 'running',
    title: `Map ${topic.trim()}`, input: req.body,
    progress: '', result: null, error: null, createdAt: now(), updatedAt: now(),
  });
  const send = jobSend(res, job);
  try {
    // Subtopics and periods are independent Claude calls — periods only reads
    // topic/description, never the subtopic list — so running them sequentially was
    // pure dead time: two ~2-3 minute calls back to back instead of the ~2-3 minutes
    // the slower of the two actually takes. Progress lines from both are interleaved
    // as they stream; `send` doesn't care which call a line came from.
    const [subtopicsResult, eraGroups] = await Promise.all([
      proposeSubtopics(
        topic.trim(),
        description?.trim() ?? '',
        dom,
        (line) => send('progress', { line }),
      ),
      // Best-effort, same as the client used to treat it: without periods the
      // research step falls back to its old spread-across-eras behaviour rather than
      // failing the whole "map the field" step.
      proposePeriods(
        { topic: topic.trim(), description: description?.trim() ?? '', domain: dom },
        (line) => send('progress', { line }),
      ).catch((): EraGroup[] => []),
    ]);
    const { subtopics, suggestedCount } = subtopicsResult;

    send('done', { subtopics, suggestedCount, eraGroups, jobId: job.id });
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

  // This is one of the two calls whose result needs to survive the browser closing —
  // it returns a review-before-save proposal, not something the server writes itself
  // (see shared/types.ts's `Job`, and jobSend above).
  const job = await createJob({
    id: newId(), domain: dom, kind: 'items', status: 'running',
    title: `Research ${topic.trim()}`, input: req.body,
    progress: '', result: null, error: null, createdAt: now(), updatedAt: now(),
  });
  const send = jobSend(res, job);
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

    send('done', { items: withImages, jobId: job.id });
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

// "Accept changes" on a boundary issue — the review named the problem, this carries
// out the fix: Claude works out the concrete result (services/claude.ts,
// planBoundaryFix) and this route updates, creates and deletes datasets accordingly.
//
// `fields` must be exactly the topics the boundary issue named — that's how the
// stored map's `lastReview` finds and drops the issue once it's been handled.
curationRouter.post('/boundary-fix', async (req, res) => {
  const { domain: rawDomain, kind, fields: topics, proposal, why } = req.body as {
    domain?: Domain;
    kind?: BoundaryKind;
    fields?: string[];
    proposal?: string;
    why?: string;
  };
  const domain = normalizeDomain(rawDomain);

  const send = sse(res);
  try {
    if (!kind || !topics?.length || !proposal?.trim()) {
      send('error', { error: 'kind, fields and proposal are required' });
      return res.end();
    }

    send('progress', { line: 'Reading the field(s)…' });
    const summaries = await listDatasets(domain);
    const byTopic = new Map(summaries.map((s) => [s.topic.trim().toLowerCase(), s]));
    const datasets: Dataset[] = [];
    for (const topic of topics) {
      const summary = byTopic.get(topic.trim().toLowerCase());
      const ds = summary && (await getDataset(summary.id));
      if (!ds) {
        send('error', { error: `Field "${topic}" no longer exists — try reviewing again.` });
        return res.end();
      }
      datasets.push(ds);
    }

    const plan = await planBoundaryFix(
      {
        domain,
        kind,
        proposal: proposal.trim(),
        why: why?.trim() ?? '',
        fields: datasets.map((d) => ({
          topic: d.topic,
          description: d.description,
          subtopics: d.subtopics,
          items: d.items.map((i) => ({ id: i.id, name: i.name, subtopic: i.subtopic, year: i.year })),
        })),
      },
      (line) => send('progress', { line }),
    );

    send('progress', { line: 'Writing the change…' });
    const pool = new Map(datasets.flatMap((d) => d.items.map((i) => [i.id, i] as const)));
    const byTopicExact = new Map(datasets.map((d) => [d.topic, d]));

    const claimedTopics = new Set<string>();
    const updated: Dataset[] = [];
    for (const rf of plan.fields) {
      const source = rf.sourceTopic ? byTopicExact.get(rf.sourceTopic) : undefined;
      const subtopics = rf.subtopics.length ? rf.subtopics : (source?.subtopics ?? []);
      const items = rf.itemIds
        .map((id) => pool.get(id))
        .filter((it): it is Item => !!it)
        .map((it) => ({ ...it, subtopic: canonicalSubtopic(it.subtopic, subtopics) }));

      if (source) {
        claimedTopics.add(source.topic);
        updated.push(
          await saveDataset(
            { ...source, topic: rf.topic || source.topic, description: rf.description || source.description, subtopics, items },
            slugifyTopic(source.topic),
          ),
        );
      } else {
        updated.push(
          await saveDataset({
            id: newId(),
            domain,
            topic: rf.topic,
            description: rf.description,
            subtopics,
            eraGroups: [],
            items,
            createdAt: now(),
            updatedAt: now(),
          }),
        );
      }
    }

    // Whatever no result field claimed as its source had every one of its items moved
    // elsewhere by the plan — it's fully absorbed, so it goes away rather than lingering
    // as an empty field nobody asked to keep.
    const deletedTopics: string[] = [];
    for (const d of datasets) {
      if (claimedTopics.has(d.topic)) continue;
      await deleteDataset(d.id, slugifyTopic(d.topic));
      deletedTopics.push(d.topic);
    }

    // Best-effort: drop the now-handled issue from the map's stored review, so it
    // doesn't keep showing an "Accept changes" button for a fix already applied.
    let map = null;
    try {
      const stored = await getWorldMap(domain);
      if (stored?.lastReview) {
        const wanted = new Set(topics.map((t) => t.trim().toLowerCase()));
        const remaining = stored.lastReview.boundaryIssues.filter(
          (b: BoundaryIssue) =>
            !(
              b.kind === kind &&
              b.fields.length === topics.length &&
              b.fields.every((f) => wanted.has(f.trim().toLowerCase()))
            ),
        );
        if (remaining.length !== stored.lastReview.boundaryIssues.length) {
          map = await saveWorldMap({
            ...stored,
            lastReview: { ...stored.lastReview, boundaryIssues: remaining },
          });
        } else {
          map = stored;
        }
      }
    } catch { /* the next review will settle it either way */ }

    send('done', { updated, deletedTopics, note: plan.note, map });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Applying the fix failed' });
  }
  res.end();
});

// "Re-fetch images" — run the current pipeline over a dataset that is already saved.
//
// Images were only ever resolved at curation time, so every improvement to sourcing
// applied to future items and left existing ones exactly as they were. That is how a
// field ends up permanently holding a screenshot service's "generating…" placeholder,
// or a live 2026 capture standing in for a 1979 design: the item was saved before the
// pipeline could tell. This is the repair path.
//
// Returns the proposals rather than writing them — same review-before-save posture as
// the rest of curation, since a re-resolve can also make an image worse.
curationRouter.post('/re-resolve', async (req, res) => {
  const { datasetId, onlyProblems } = req.body as { datasetId: string; onlyProblems?: boolean };
  if (!datasetId?.trim()) return res.status(400).json({ error: 'datasetId is required' });

  const send = sse(res);
  try {
    const ds = await getDataset(datasetId.trim());
    if (!ds) {
      send('error', { error: 'Dataset not found' });
      return res.end();
    }
    if (normalizeDomain(ds.domain) !== 'digital') {
      send('error', { error: 'Re-resolving images is a digital-world operation.' });
      return res.end();
    }

    const all = ds.items ?? [];
    // "Problems" is deliberately broad: a missing image, one whose capture can't be
    // showing the stated year, anything never scored (everything saved before this
    // existed), and anything scored below high.
    const targets = onlyProblems
      ? all.filter(
          (it) =>
            !it.image ||
            !isPeriodAccurate(it.capture, it.year) ||
            !it.capture?.confidence ||
            it.capture.confidence !== 'high',
        )
      : all;

    if (!targets.length) {
      send('done', { items: [], checked: 0, changed: 0 });
      return res.end();
    }
    send('progress', { line: `Re-fetching images for ${targets.length} of ${all.length} items…` });

    let done = 0;
    let changed = 0;
    const updated = await mapWithLimit(targets, IMAGE_CONCURRENCY, async (it) => {
      const result = await resolveDigitalImage({
        name: it.name,
        year: it.year,
        imageKind: it.imageKind,
        url: it.url,
        wikipediaTitle: it.wikipediaTitle,
        imageQuery: it.imageQuery,
      });
      done += 1;

      // Never trade a picture for nothing: a source being down today shouldn't blank an
      // item that already has something on screen.
      const keep = !result.image && !!it.image;
      const isNew = !keep && result.image !== it.image;
      if (isNew) changed += 1;

      send('progress', {
        line:
          `${done}/${targets.length} · ${it.name} → ` +
          (keep
            ? 'nothing better found, kept existing'
            : isNew
              ? `${result.capture?.source ?? '?'} (${result.capture?.confidence ?? '?'})`
              : 'unchanged'),
      });

      return keep
        ? it
        : { ...it, image: result.image, capture: result.capture, candidates: result.candidates };
    });

    send('done', { items: updated, checked: targets.length, changed });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Re-resolve failed' });
  }
  res.end();
});

// "What's missing?" — breadth-first coverage sweep.
curationRouter.post('/gaps', async (req, res) => {
  const { topic, description, subtopics, items, domain, eraGroups, focus } = req.body as {
    topic: string;
    description: string;
    subtopics: Subtopic[];
    items: Item[];
    domain: Domain;
    eraGroups?: EraGroup[];
    focus?: string;
  };
  if (!topic?.trim()) return res.status(400).json({ error: 'topic is required' });
  const dom: Domain = normalizeDomain(domain);

  // Durable like /items and /gap-fill below — this is the third proposal-for-review
  // call, and until now was the one exception: its result only ever lived in the
  // live SSE stream, so a refresh mid-sweep (or after) lost the gap list outright,
  // with no row in the resume banner to get it back from.
  const job = await createJob({
    id: newId(), domain: dom, kind: 'gaps', status: 'running',
    title: `Review ${topic.trim()} for gaps`, input: req.body,
    progress: '', result: null, error: null, createdAt: now(), updatedAt: now(),
  });
  const send = jobSend(res, job);
  try {
    const { gaps, suggestedCount } = await findGaps(
      {
        topic: topic.trim(),
        description: description?.trim() ?? '',
        subtopics: subtopics ?? [],
        items: items ?? [],
        domain: dom,
        eraGroups: eraGroups ?? [],
        focus: focus ?? '',
      },
      (line) => send('progress', { line }),
    );
    send('done', { gaps, suggestedCount, jobId: job.id });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Gap analysis failed' });
  }
  res.end();
});

// "Add what's missing" — research NEW items targeting the reported gaps, weighing the
// user's own feedback, then fetch a Wikimedia lead image for each (same as /items).
// Returns the proposed items plus a `note` explaining how the feedback was handled.
curationRouter.post('/gap-fill', async (req, res) => {
  const { topic, description, subtopics, items, gaps, count, feedback, domain, eraGroups, mode } =
    req.body as {
      mode?: FillMode;
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
  // A direct request with nothing in it has no brief at all — refused here rather than
  // spending a Claude call on "propose N items about nothing in particular".
  if (mode === 'direct' && !feedback?.trim()) {
    return res.status(400).json({ error: 'a request is required' });
  }
  const dom: Domain = normalizeDomain(domain);

  // The other durable call — see the comment on /items above.
  const job = await createJob({
    id: newId(), domain: dom, kind: 'gap-fill', status: 'running',
    title: `Expand ${topic.trim()}`, input: req.body,
    progress: '', result: null, error: null, createdAt: now(), updatedAt: now(),
  });
  const send = jobSend(res, job);
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
        mode: mode === 'direct' ? 'direct' : 'gaps',
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
    send('done', { items: withImages, note, duplicates, unsetSubtopics, jobId: job.id });
  } catch (err: any) {
    send('error', { error: err?.message ?? 'Gap fill failed' });
  }
  res.end();
});
