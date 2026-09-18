import { Router, type NextFunction, type Request, type Response } from 'express';
import { CLAUDE_MODEL, CLAUDE_TIMEOUT_MS, HF_APP_SECRET } from '../config.ts';
import { brainCalls, serverStartedAt } from '../services/brain.ts';
import { loadRules, SYSTEM_TEMPLATE } from '../services/claude.ts';
import type { BrainSetup } from '../../../shared/types.ts';

// The settings cog's read path: how this app prompts Claude, as one document
// (shared/types.ts's `BrainSetup`). Read-only by design — the rulebook is edited as a
// file in the repo, where a change is versioned and reviewable, and this shows what
// the running server is actually using.
export const brainRouter = Router();

brainRouter.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const setup: BrainSetup = {
      model: CLAUDE_MODEL,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      // Whether the secret is set, never the secret (or the proxy's address) itself.
      proxyConfigured: !!HF_APP_SECRET,
      systemTemplate: SYSTEM_TEMPLATE,
      rules: await loadRules(),
      rulesPath: 'server/src/prompts/curation-rules.md',
      calls: brainCalls(),
      serverStartedAt: serverStartedAt(),
    };
    // Last-run data changes with every call; a cached copy would show a stale brain.
    res.set('Cache-Control', 'no-store');
    res.json(setup);
  } catch (err) { next(err); }
});
