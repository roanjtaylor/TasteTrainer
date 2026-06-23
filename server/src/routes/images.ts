import { Router, type NextFunction, type Request, type Response } from 'express';
import { searchImages, wikimediaImage } from '../services/images.ts';

export const imagesRouter = Router();

imagesRouter.get('/wikimedia', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const title = String(req.query.title ?? '');
    res.json({ image: await wikimediaImage(title) });
  } catch (err) { next(err); }
});

imagesRouter.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q ?? '');
    res.json({ images: await searchImages(q, 9) });
  } catch (err) { next(err); }
});
