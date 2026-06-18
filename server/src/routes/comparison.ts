import { Router } from 'express';
import { getDataset, getResults, saveResults } from '../storage.ts';
import { applyVote, emptyResults, leaderboard, pickPair, TARGET_PER_ITEM } from '../elo.ts';
import { eraOf } from '../util.ts';
import type { Dataset, Item, ResultsFile } from '../../../shared/types.ts';

export const comparisonRouter = Router();

/** Parse a comma-separated query filter into a Set, or null for "no filter". */
function parseFilter(value: unknown): Set<string> | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

/** Apply the chosen scope (subtopics AND/OR eras) to a dataset's items. */
function scopePool(ds: Dataset, subtopics: Set<string> | null, eras: Set<string> | null): Item[] {
  return ds.items.filter((it) => {
    if (subtopics && !subtopics.has(it.subtopic)) return false;
    if (eras && !eras.has(eraOf(it.year))) return false;
    return true;
  });
}

/** Scoped progress toward the size-based "done" target (5-comparison.md). */
function progressFor(results: ResultsFile, pool: Item[]) {
  const target = Math.max(1, TARGET_PER_ITEM * pool.length);
  const scopedGames = pool.reduce((sum, it) => sum + (results.ratings[it.id]?.games ?? 0), 0);
  const done = Math.round(scopedGames / 2); // each comparison touches two items
  return { done, target, complete: done >= target };
}

async function loadResults(datasetId: string): Promise<ResultsFile> {
  return (await getResults(datasetId)) ?? emptyResults(datasetId);
}

// Next pair for the chosen scope.
comparisonRouter.get('/:id/pair', async (req, res) => {
  const ds = await getDataset(req.params.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });
  const pool = scopePool(ds, parseFilter(req.query.subtopics), parseFilter(req.query.eras));
  const results = await loadResults(ds.id);
  const pair = pickPair(results, pool);
  res.json({
    pair: pair ? { a: pair[0], b: pair[1] } : null,
    progress: progressFor(results, pool),
  });
});

// Record a vote: winner beat loser.
comparisonRouter.post('/:id/vote', async (req, res) => {
  const ds = await getDataset(req.params.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });
  const { winnerId, loserId } = req.body as { winnerId: string; loserId: string };
  if (!winnerId || !loserId) return res.status(400).json({ error: 'winnerId and loserId required' });
  const results = await loadResults(ds.id);
  applyVote(results, winnerId, loserId);
  await saveResults(results);
  res.json({ ok: true });
});

// Leaderboard for the chosen scope, best -> worst.
comparisonRouter.get('/:id/leaderboard', async (req, res) => {
  const ds = await getDataset(req.params.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });
  const pool = scopePool(ds, parseFilter(req.query.subtopics), parseFilter(req.query.eras));
  const results = await loadResults(ds.id);
  res.json({
    leaderboard: leaderboard(results, pool),
    progress: progressFor(results, pool),
  });
});
