import { Router, type NextFunction, type Request, type Response } from 'express';
import { screenshotCandidates, searchImages } from '../services/images.ts';

export const imagesRouter = Router();

imagesRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '');
    res.json({ images: await searchImages(q, 9) });
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
