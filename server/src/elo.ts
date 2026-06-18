// Elo ranking for the 1v1 comparison pillar (5-comparison.md). Elo only, MVP.
import type { EloEntry, Item, ResultsFile } from '../../shared/types.ts';
import { now } from './util.ts';

export const START_RATING = 1000;
const K = 32;

/** Comparisons-per-item target that defines a "done" session (5-comparison.md). */
export const TARGET_PER_ITEM = 5;

export function emptyResults(datasetId: string): ResultsFile {
  return { datasetId, ratings: {}, comparisons: 0, updatedAt: now() };
}

function entryFor(results: ResultsFile, itemId: string): EloEntry {
  let e = results.ratings[itemId];
  if (!e) {
    e = { itemId, rating: START_RATING, wins: 0, losses: 0, games: 0 };
    results.ratings[itemId] = e;
  }
  return e;
}

const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/** Record one comparison: winner beat loser. Mutates and returns results. */
export function applyVote(results: ResultsFile, winnerId: string, loserId: string): ResultsFile {
  const w = entryFor(results, winnerId);
  const l = entryFor(results, loserId);
  const ew = expected(w.rating, l.rating);
  const el = expected(l.rating, w.rating);
  w.rating = Math.round(w.rating + K * (1 - ew));
  l.rating = Math.round(l.rating + K * (0 - el));
  w.wins += 1;
  l.losses += 1;
  w.games += 1;
  l.games += 1;
  results.comparisons += 1;
  return results;
}

/**
 * Pick the next pair from a scoped pool. Prefers the least-seen items (so coverage
 * spreads), then pairs each with a similarly-rated opponent (more informative).
 */
export function pickPair(results: ResultsFile, pool: Item[]): [Item, Item] | null {
  if (pool.length < 2) return null;
  const games = (id: string) => results.ratings[id]?.games ?? 0;
  const rating = (id: string) => results.ratings[id]?.rating ?? START_RATING;

  const byGames = [...pool].sort((a, b) => games(a.id) - games(b.id));
  const a = byGames[0];

  // Opponent: closest rating among the rest, with a little randomness among ties.
  const rest = byGames.slice(1).sort((x, y) => {
    const dx = Math.abs(rating(x.id) - rating(a.id));
    const dy = Math.abs(rating(y.id) - rating(a.id));
    return dx - dy;
  });
  const candidates = rest.slice(0, Math.min(4, rest.length));
  const b = candidates[Math.floor(Math.random() * candidates.length)];
  // Randomise left/right so position carries no bias.
  return Math.random() < 0.5 ? [a, b] : [b, a];
}

/** Leaderboard for a scoped pool: best -> worst by rating. */
export function leaderboard(results: ResultsFile, pool: Item[]) {
  return pool
    .map((item) => ({
      item,
      entry: results.ratings[item.id] ?? {
        itemId: item.id,
        rating: START_RATING,
        wins: 0,
        losses: 0,
        games: 0,
      },
    }))
    .sort((a, b) => b.entry.rating - a.entry.rating);
}
