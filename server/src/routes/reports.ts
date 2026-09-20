import { Router, type NextFunction, type Request, type Response } from 'express';
import { deleteItemReport, listItemReports, setItemReportStatus } from '../storage.ts';
import type { ItemReportStatus } from '../../../shared/types.ts';

/**
 * Visitor-flagged item problems, surfaced inside the app (DatasetView's report panel)
 * so the curator can see what's been reported and hand it to the Claude agent to fix
 * (agentTools.ts#get_item_reports reads the same rows). Open like curation/datasets —
 * personal datasets are never reportable in the first place (embed.ts 404s them before
 * a report could ever name one), so there's nothing here for auth to gate.
 */
export const reportsRouter = Router();

reportsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status === 'resolved' ? 'resolved' : req.query.status === 'all' ? undefined : 'open';
    const datasetId = typeof req.query.datasetId === 'string' ? req.query.datasetId : undefined;
    res.set('Cache-Control', 'no-store');
    res.json(await listItemReports({ datasetId, status: status as ItemReportStatus | undefined }));
  } catch (err) { next(err); }
});

reportsRouter.post('/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setItemReportStatus(req.params.id, 'resolved');
    res.status(204).end();
  } catch (err) { next(err); }
});

reportsRouter.post('/:id/reopen', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await setItemReportStatus(req.params.id, 'open');
    res.status(204).end();
  } catch (err) { next(err); }
});

reportsRouter.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    await deleteItemReport(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
