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
//
// A job that is genuinely still running is refused (409): the server has no way to
// stop the Claude call behind it, so deleting the row only throws away the result
// when it lands — `updateJob` is a no-op on a missing row — and that is exactly how a
// half-hour research run vanished without trace. A job that only READS as running
// but has gone stale (storage.ts's rowToJob flips it to `error`) is still deletable.
jobsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await getJob(req.params.id);
    if (job?.status === 'running') {
      return res.status(409).json({ error: 'This job is still running; it can be dismissed once it finishes.' });
    }
    await deleteJob(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
