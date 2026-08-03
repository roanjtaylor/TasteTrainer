// Loads server/.env.local into process.env for local dev.
//
// ‼️ This MUST live in its own module and be the FIRST import of index.ts.
// ESM hoists every `import` and evaluates it before any top-level statement in
// the importing file, so a bare `dotenv.config()` in index.ts runs too late —
// config.ts (and storage.ts's module-level createClient) have already read the
// empty env by then ("supabaseUrl is required."). Import order of modules is
// source order, so putting the load here makes it happen first.
//
// In production (Render) there is no .env.local; real env vars are already set
// and dotenv silently no-ops on the missing file.
import * as dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// quiet: dotenv's "injected env (2)" banner is noise in the concurrently-merged log.
dotenv.config({ path: join(here, '..', '.env.local'), quiet: true });
