// TasteTrainer backend: serves the API and reads/writes datasets on disk.
// The browser can't safely write to disk or hold credentials, so this small
// local server does that work (1-setup.md).
import express from 'express';
import cors from 'cors';
import { PORT } from './config.ts';
import { datasetsRouter } from './routes/datasets.ts';
import { curationRouter } from './routes/curation.ts';
import { imagesRouter } from './routes/images.ts';
import { comparisonRouter } from './routes/comparison.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/datasets', datasetsRouter);
app.use('/api/curation', curationRouter);
app.use('/api/images', imagesRouter);
app.use('/api/comparison', comparisonRouter);

app.listen(PORT, () => {
  console.log(`TasteTrainer server listening on http://localhost:${PORT}`);
});
