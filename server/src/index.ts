// TasteTrainer backend: serves the API and reads/writes datasets on disk.
// The browser can't safely write to disk or hold credentials, so this small
// local server does that work (1-setup.md).
//
// ‼️ Dev runner: this server is launched with `node --watch --import tsx`, NOT
// `tsx watch` (see server/package.json). `tsx watch` runs the app in a
// supervisor→child split whose loader resolves modules synchronously via
// Atomics.wait; under `concurrently`'s piped (non-TTY) stdio that wait never
// completes when we first import the Claude Agent SDK, wedging the event loop so
// hard that even timeouts never fire (the "stuck on loading @anthropic-ai/
// claude-agent-sdk" hang). `node --watch` registers tsx's loader in-process and
// avoids that deadlock while still auto-reloading. Don't switch it back to
// `tsx watch`.
//
// The heavy modules below are loaded via dynamic import() with a log before each
// one, so an import-time problem pins to a single module instead of leaving the
// process silent. `import type` is erased at runtime and stays static.
import type { NextFunction, Request, Response } from 'express';

const log = (...args: unknown[]) => console.log('[server]', ...args);
log(`server starting (pid ${process.pid}, node ${process.version})`);

process.on('uncaughtException', (err) => {
  console.error('[server] FATAL uncaughtException — server may exit:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[server] FATAL unhandledRejection:', reason);
});

// If any line below is the LAST one printed, that module is where it hangs/throws.
log('importing express…');
const { default: express } = await import('express');
log('importing cors…');
const { default: cors } = await import('cors');
log('importing ./config.ts…');
const { PORT } = await import('./config.ts');
log('importing ./routes/datasets.ts…');
const { datasetsRouter } = await import('./routes/datasets.ts');
log('importing ./routes/curation.ts (this pulls in the Claude Agent SDK)…');
const { curationRouter } = await import('./routes/curation.ts');
log('importing ./routes/images.ts…');
const { imagesRouter } = await import('./routes/images.ts');
log('importing ./routes/comparison.ts…');
const { comparisonRouter } = await import('./routes/comparison.ts');
log('all imports complete — building app');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Debug: log every incoming API request and its outcome (status + ms).
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  log(`--> ${req.method} ${req.url}`);
  res.on('finish', () =>
    log(`<-- ${req.method} ${req.url} ${res.statusCode} (${Date.now() - start}ms)`),
  );
  next();
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/datasets', datasetsRouter);
app.use('/api/curation', curationRouter);
app.use('/api/images', imagesRouter);
app.use('/api/comparison', comparisonRouter);

// Debug: catch anything a route throws/forwards so it's logged with a stack
// server-side AND returned as JSON the client can display (not a bare 500).
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error(`[server] ERROR handling ${req.method} ${req.url}:`, err);
  if (res.headersSent) return;
  res.status(500).json({ error: err?.message ?? 'Internal server error' });
});

const server = app.listen(PORT, () => {
  log('listening on', server.address(), `-> http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Exit instead of lingering. A server that can't bind but stays alive becomes a
    // zombie; stacking a few (e.g. from re-running `npm run dev`) pile up CLI
    // subprocesses and contend for resources — which is how this backend wedged.
    console.error(`[server] port ${PORT} already in use — exiting. Stop the other server first.`);
    process.exit(1);
  } else {
    console.error('[server] server error:', err);
  }
});
