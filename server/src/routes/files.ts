import { Router, type NextFunction, type Request, type Response } from 'express';
import { createUpload, isAcceptedType, signOne } from '../services/personalFiles.ts';
import { PERSONAL_BUCKET } from '../config.ts';

export const filesRouter = Router();

// Uploading your own files into the personal world (9-personal-and-auth.md). Two
// steps around a direct browser→Storage upload; see services/personalFiles.ts for why
// the bytes never pass through here.

// 1. Before the upload: where the file will live, and a single-use token to put it there.
filesRouter.post('/uploads', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const contentType = String((req.body as { contentType?: string })?.contentType ?? '');
    if (!isAcceptedType(contentType)) {
      return res
        .status(400)
        .json({ error: 'Only image files can be uploaded (JPEG, PNG, WebP, GIF, AVIF).' });
    }
    // The bucket name rides along so the browser never has its own copy to drift.
    const upload = await createUpload(req.user!.id, contentType);
    res.status(201).json({ bucket: PERSONAL_BUCKET, ...upload });
  } catch (err) { next(err); }
});

// 2. After it: a link the browser can actually show. Scoped to the caller's own
// folder, so a path can't be used to mint a link to somebody else's file.
filesRouter.post('/signed', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const path = String((req.body as { path?: string })?.path ?? '');
    if (!path.startsWith(`${req.user!.id}/`) || path.includes('..')) {
      return res.status(400).json({ error: 'Not one of your files.' });
    }
    res.json({ url: await signOne(path) });
  } catch (err) { next(err); }
});
