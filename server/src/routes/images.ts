import { Router } from 'express';
import { searchImages, wikimediaImage } from '../services/images.ts';

export const imagesRouter = Router();

// Resolve a single Wikipedia title to its lead image URL.
imagesRouter.get('/wikimedia', async (req, res) => {
  const title = String(req.query.title ?? '');
  res.json({ image: await wikimediaImage(title) });
});

// The 3x3 picker: first 9 DuckDuckGo image results for a query.
imagesRouter.get('/search', async (req, res) => {
  const q = String(req.query.q ?? '');
  res.json({ images: await searchImages(q, 9) });
});
