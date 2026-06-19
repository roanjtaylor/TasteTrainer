// TasteTrainer backend: serves the API and reads/writes datasets on disk.
// The browser can't safely write to disk or hold credentials, so this small
// local server does that work (1-setup.md).
//
// ‼️ DEV RUNNER — run with plain `tsx` (NO watch). See server/package.json.
// This was hard-won; do not "improve" it by re-adding a file watcher:
//   • `tsx watch` deadlocks. Its loader resolves modules synchronously via
//     Atomics.wait; under `concurrently`'s piped (non-TTY) stdio that wait never
//     returns the first time we import the Claude Agent SDK, wedging the event loop
//     so completely that even timeouts can't fire — the "stuck on loading
//     @anthropic-ai/claude-agent-sdk" hang.
//   • `node --watch` avoids the deadlock but restarts the server spuriously on
//     Windows (fs.watch double-fires), dropping in-flight curation calls (ECONNRESET).
// Plain `tsx` has neither problem. The only cost is no server auto-reload — restart
// `npm run dev` after editing server code (the Vite-served UI still hot-reloads).
// (Belt-and-suspenders for any future watcher: CLAUDE_CWD in services/claude.ts
// keeps the Claude CLI's scratch writes out of the project tree.)
import express, { type NextFunction, type Request, type Response } from 'express';
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

// Turn anything a route throws into JSON the client can display, not a bare 500.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] request error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: err?.message ?? 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Exit rather than linger. A server that can't bind but stays alive becomes a
    // zombie; re-running `npm run dev` would stack several, each spawning Claude CLI
    // subprocesses that contend for resources — a slow path to a wedged backend.
    console.error(`[server] port ${PORT} already in use — exiting. Stop the other server first.`);
    process.exit(1);
  } else {
    console.error('[server] server error:', err);
  }
});
