import { Router, type NextFunction, type Request, type Response } from 'express';
import { getAllRankings, getDataset, getRanking, listRankers, saveRanking } from '../storage.ts';
import {
  applyVote,
  emptyResults,
  leaderboard,
  pickPair,
  pooledLeaderboard,
  TARGET_PER_ITEM,
} from '../elo.ts';
import { eraOf } from '../util.ts';
import { EVERYONE, cleanRankerName, rankerKeyOf } from '../../../shared/types.ts';
import type { Dataset, Item, Ranker, ResultsFile } from '../../../shared/types.ts';

export const comparisonRouter = Router();

function parseFilter(value: unknown): Set<string> | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
}

function scopePool(ds: Dataset, subtopics: Set<string> | null, eras: Set<string> | null): Item[] {
  return ds.items.filter((it) => {
    if (subtopics && !subtopics.has(it.subtopic)) return false;
    if (eras && !eras.has(eraOf(it.year))) return false;
    return true;
  });
}

function progressFor(results: ResultsFile, pool: Item[]) {
  const target = Math.max(1, TARGET_PER_ITEM * pool.length);
  const scopedGames = pool.reduce((sum, it) => sum + (results.ratings[it.id]?.games ?? 0), 0);
  const done = Math.round(scopedGames / 2);
  return { done, target, complete: done >= target };
}

/**
 * The name on the cabinet. Arrives as a plain `?ranker=` string (or `{ ranker }` in a
 * vote body) — no session, no token, which is the whole point: you type a name and
 * your scores are yours. Returns null when nothing usable was given, and the caller
 * decides whether that's fatal (ranking) or just means the pooled view (leaderboard).
 */
function parseRanker(value: unknown): Ranker | null {
  const name = cleanRankerName(String(value ?? ''));
  if (!name) return null;
  const key = rankerKeyOf(name);
  if (!key || key === EVERYONE) return null;
  return { key, name };
}

/** Everyone who has ranked this dataset. Drives the leaderboard's name tabs. */
comparisonRouter.get('/:id/rankers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rankers = await listRankers(req.params.id);
    res.set('Cache-Control', 'private, max-age=15');
    res.json({ rankers });
  } catch (err) { next(err); }
});

comparisonRouter.get('/:id/pair', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ranker = parseRanker(req.query.ranker);
    if (!ranker) return res.status(400).json({ error: 'A ranker name is required to rank.' });

    const ds = await getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });

    const pool = scopePool(ds, parseFilter(req.query.subtopics), parseFilter(req.query.eras));
    const results = await getRanking(ds.id, ranker);
    const pair = pickPair(results, pool);
    // Never cached: the next pair depends on the vote just cast.
    res.set('Cache-Control', 'no-store');
    res.json({
      pair: pair ? { a: pair[0], b: pair[1] } : null,
      progress: progressFor(results, pool),
    });
  } catch (err) { next(err); }
});

comparisonRouter.post('/:id/vote', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { winnerId, loserId, ranker: rawRanker } = req.body as {
      winnerId: string;
      loserId: string;
      ranker: string | Ranker;
    };
    const ranker = parseRanker(typeof rawRanker === 'string' ? rawRanker : rawRanker?.name);
    if (!ranker) return res.status(400).json({ error: 'A ranker name is required to vote.' });
    if (!winnerId || !loserId) {
      return res.status(400).json({ error: 'winnerId and loserId required' });
    }

    const ds = await getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });
    // Only ever record votes on items this dataset actually contains.
    const known = new Set(ds.items.map((i) => i.id));
    if (!known.has(winnerId) || !known.has(loserId)) {
      return res.status(400).json({ error: 'Both items must belong to this dataset.' });
    }

    const results = (await getRanking(ds.id, ranker)) ?? emptyResults(ds.id, ranker);
    results.ranker = results.ranker ?? ranker;
    applyVote(results, winnerId, loserId);
    await saveRanking(results);
    res.json({ ok: true, comparisons: results.comparisons });
  } catch (err) { next(err); }
});

/**
 * A leaderboard for one scope. `?ranker=` selects whose board: a name for that
 * person's own ranking, or "everyone" (the default) for the pooled view.
 */
comparisonRouter.get('/:id/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ds = await getDataset(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });

    const pool = scopePool(ds, parseFilter(req.query.subtopics), parseFilter(req.query.eras));
    const requested = String(req.query.ranker ?? '').trim();
    const ranker = requested.toLowerCase() === EVERYONE ? null : parseRanker(requested);

    // Short max-age, not no-store: a leaderboard is re-read on every tab switch and
    // filter change, and 10s of staleness is invisible next to a round trip saved.
    // Applied only on the success paths, so a failed read is never cached.
    const cacheable = () => res.set('Cache-Control', 'private, max-age=10');

    if (!ranker) {
      const all = await getAllRankings(ds.id);
      cacheable();
      return res.json({
        ranker: EVERYONE,
        rankerCount: all.length,
        leaderboard: pooledLeaderboard(all, pool),
        progress: progressFor(
          // Pooled progress is the sum of everyone's work in this scope.
          all.reduce<ResultsFile>((merged, r) => {
            for (const [itemId, entry] of Object.entries(r.ratings ?? {})) {
              const current = merged.ratings[itemId];
              merged.ratings[itemId] = current
                ? { ...current, games: current.games + entry.games }
                : { ...entry };
            }
            return merged;
          }, emptyResults(ds.id)),
          pool,
        ),
      });
    }

    const results = await getRanking(ds.id, ranker);
    cacheable();
    res.json({
      ranker: ranker.key,
      leaderboard: leaderboard(results, pool),
      progress: progressFor(results, pool),
    });
  } catch (err) { next(err); }
});
