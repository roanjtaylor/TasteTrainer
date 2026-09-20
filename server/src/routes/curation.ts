import { Router } from 'express';
import type { Response } from 'express';
import { mapWithLimit, resolveDigitalImage, resolvePhysicalImage } from '../services/imageResolvers.ts';
import { getDataset } from '../storage.ts';
import { isPeriodAccurate, normalizeDomain } from '../../../shared/types.ts';
import type { Domain, ProposedItem } from '../../../shared/types.ts';

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
export async function attachImages(
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
      // Alternatives ride along only when the pick isn't trustworthy, so the item's
      // image picker can offer a one-click swap without bloating every payload — same
      // rule the digital branch below already applies.
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

    // Alternatives ride along only when the pick isn't trustworthy, so the item's image
    // picker can offer a one-click swap without bloating every payload.
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

// Re-resolving a whole field's images takes minutes, and we want the UI to show live
// progress instead of a blackbox spinner. So the endpoint streams Server-Sent Events:
// `progress` lines as each item lands, then a single `done` (with the payload) or
// `error`. The client reads the stream with fetch + a ReadableStream reader (web/lib/api).
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

// "Re-fetch images" — run the current pipeline over a dataset that is already saved.
//
// Images were only ever resolved at curation time, so every improvement to sourcing
// applied to future items and left existing ones exactly as they were. That is how a
// field ends up permanently holding a screenshot service's "generating…" placeholder,
// or a live 2026 capture standing in for a 1979 design: the item was saved before the
// pipeline could tell. This is the repair path.
//
// Returns the proposals rather than writing them — the same accept-before-it-lands
// posture as Claude's own changesets, since a re-resolve can also make an image worse.
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
