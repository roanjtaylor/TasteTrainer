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
// ‼️ Must stay the first import: loads .env.local before config.ts/storage.ts
// read process.env at module scope. See env.ts for why it can't be inlined here.
import './env.ts';

import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import compression from 'compression';
import { PORT } from './config.ts';
import { datasetsRouter } from './routes/datasets.ts';
import { curationRouter } from './routes/curation.ts';
import { imagesRouter } from './routes/images.ts';
import { comparisonRouter } from './routes/comparison.ts';
import { mapRouter } from './routes/map.ts';

const app = express();

// Dataset JSON is highly repetitive (the same field names on every item), so gzip
// takes a typical response down by roughly 80% — the cheapest single win available
// on both first-load time and bandwidth.
//
// Curation's live progress (routes/curation.ts) is Server-Sent Events, and a
// compressor holds bytes back until it has a worthwhile block to emit — which for a
// stream of short `progress` lines means the UI would sit silent and then catch up in
// a burst. So SSE is excluded explicitly rather than left to the default filter.
app.use(
  compression({
    filter: (req, res) => {
      const type = String(res.getHeader('Content-Type') ?? '');
      if (type.includes('text/event-stream')) return false;
      return compression.filter(req, res);
    },
  }),
);

app.use(cors({
  // Let the browser read the validator so a client-side cache can send it back.
  exposedHeaders: ['ETag'],
}));
app.use(express.json({ limit: '5mb' }));

// Strong-ish validators on JSON bodies: routes set Cache-Control, Express computes the
// ETag, and a revisit that hasn't changed costs an empty 304 instead of the payload.
app.set('etag', 'strong');

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/datasets', datasetsRouter);
app.use('/api/curation', curationRouter);
app.use('/api/images', imagesRouter);
app.use('/api/comparison', comparisonRouter);
app.use('/api/map', mapRouter);

// Turn anything a route throws into JSON the client can display, not a bare 500.
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server] request error:', err);
  if (res.headersSent) return;
  // Routes set Cache-Control only after their reads succeed, but a failure must never
  // be storable — a cached 500 would outlive the fault that caused it.
  res.set('Cache-Control', 'no-store');
  res.status(500).json({ error: err?.message ?? 'Internal server error' });
});

const server = app.listen(PORT, () => {
  // No "[server]" prefix — concurrently already labels each line.
  console.log(`listening on http://localhost:${PORT}`);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    // Exit rather than linger. A server that can't bind but stays alive becomes a
    // zombie; re-running `npm run dev` would stack several, each spawning Claude CLI
    // subprocesses that contend for resources — a slow path to a wedged backend.
    console.error(`port ${PORT} already in use — exiting. Stop the other server first.`);
    process.exit(1);
  } else {
    console.error('[server] server error:', err);
  }
});
