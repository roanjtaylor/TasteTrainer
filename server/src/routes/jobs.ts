import { Router, type NextFunction, type Request, type Response } from 'express';
import { deleteJob, getJob, listJobs } from '../storage.ts';
import { optionalDomain } from '../../../shared/types.ts';

// Durable curation jobs (shared/types.ts's `Job`) — the resume banner's read path.
// Mounted at /api/curation/jobs, ahead of the broader /api/curation router (see
// server/src/index.ts), so the more specific prefix wins.
export const jobsRouter = Router();

// Unscoped when `domain` is omitted, so a global "N waiting" indicator can query both
// worlds in one call (server/src/storage.ts's `listJobs`).
jobsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await listJobs(optionalDomain(req.query.domain)));
  } catch (err) { next(err); }
});

jobsRouter.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    res.json(job);
  } catch (err) { next(err); }
});

// Called once a job's proposal has been saved or discarded — live or resumed, the
// screens that own that decision (Curate.tsx, DatasetView.tsx's GapPanel) are the
// only callers.
jobsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteJob(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
