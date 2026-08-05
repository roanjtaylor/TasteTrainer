import { Router, type NextFunction, type Request, type Response } from 'express';
import { screenshotCandidates, searchImages } from '../services/images.ts';
import { diagnoseRenderer } from '../services/screenshotRender.ts';
import { resolveDigitalImage } from '../services/imageResolvers.ts';
import type { ImageKind } from '../../../shared/types.ts';

export const imagesRouter = Router();

// Is the screenshot renderer actually alive? Renders one page and reports which step
// worked — launch, navigate, render, bucket, upload — rather than falling back.
//
// This exists because the answer used to require querying Supabase and listing a
// storage bucket by hand: the renderer threw on every call in production, the mshots
// fallback covered for it, and all 99 digital items got third-party screenshots while
// nothing anywhere said so. Defaults to an old, static Wayback snapshot because those
// render reliably when the pipeline is healthy, so a failure here is the renderer's.
imagesRouter.get('/diagnose', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = String(
      req.query.url ?? 'https://web.archive.org/web/20010331023908if_/http://www.google.com/',
    );
    const block = req.query.block !== 'false';
    const result = await diagnoseRenderer(url, block);
    res.status(result.ok ? 200 : 500).json(result);
  } catch (err) { next(err); }
});

imagesRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '');
    res.json({ images: await searchImages(q, 9) });
  } catch (err) { next(err); }
});

// Everything the resolver cascade can find for one item, scored and labelled by source.
//
// The picker used to offer digital items nothing but Wayback screenshots of a url,
// which is no help at all for the large part of the digital world that never had one —
// asking it to illustrate a 1979 spreadsheet or a typeface produced an empty grid. This
// runs the same cascade curation runs, so manual triage sees exactly what the pipeline
// saw, from every source it consults, rather than a narrower view.
imagesRouter.get('/candidates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const yearRaw = req.query.year;
    const year = yearRaw != null && yearRaw !== '' ? Number(yearRaw) : NaN;
    const result = await resolveDigitalImage({
      name: String(req.query.name ?? ''),
      year: Number.isFinite(year) ? year : null,
      imageKind: (req.query.kind as ImageKind) || undefined,
      url: String(req.query.url ?? ''),
      wikipediaTitle: String(req.query.wikipediaTitle ?? ''),
      imageQuery: String(req.query.query ?? ''),
    });
    res.json({ candidates: result.candidates });
  } catch (err) { next(err); }
});

// The digital world's alternative picker (4-images.md's DuckDuckGo grid doesn't apply —
// see 7-software-design.md): candidate Wayback/live screenshots for a site url, an
// optional target year, same string[] shape as /search so the picker UI is shared.
imagesRouter.get('/screenshot', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const url = String(req.query.url ?? '');
    const yearRaw = req.query.year;
    const year = yearRaw != null && yearRaw !== '' ? Number(yearRaw) : null;
    res.json({ images: await screenshotCandidates(url, Number.isFinite(year as number) ? year : null, 9) });
  } catch (err) { next(err); }
});
