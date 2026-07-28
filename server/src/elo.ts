// Elo ranking for the 1v1 comparison pillar (5-comparison.md). Elo only, MVP.
// Ratings are per-person (each name keeps its own ResultsFile) — `pool()` below is
// what turns the set of them into the one shared "everyone" board.
import type { EloEntry, Item, LeaderboardRow, Ranker, ResultsFile } from '../../shared/types.ts';
import { now } from './util.ts';

export const START_RATING = 1000;
const K = 32;

/** Comparisons-per-item target that defines a "done" session (5-comparison.md). */
export const TARGET_PER_ITEM = 5;

export function emptyResults(datasetId: string, ranker?: Ranker): ResultsFile {
  return { datasetId, ranker, ratings: {}, comparisons: 0, updatedAt: now() };
}

function blankEntry(itemId: string): EloEntry {
  return { itemId, rating: START_RATING, wins: 0, losses: 0, games: 0 };
}

function entryFor(results: ResultsFile, itemId: string): EloEntry {
  let e = results.ratings[itemId];
  if (!e) {
    e = blankEntry(itemId);
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

/** One person's leaderboard for a scoped pool: best -> worst by rating. */
export function leaderboard(results: ResultsFile, pool: Item[]): LeaderboardRow[] {
  return pool
    .map((item) => ({ item, entry: results.ratings[item.id] ?? blankEntry(item.id) }))
    .sort(byRating);
}

/**
 * The pooled "everyone" board: what the room as a whole prefers.
 *
 * An item's rating is the games-weighted mean of each person's rating for it, so
 * someone who ran a full session on a dataset counts for more than someone who cast
 * two votes — without letting either drown the other out the way summing ratings
 * would. Wins/losses/games are plain totals, and `rankerCount` records how many
 * people actually judged the item, which is the honest read on how settled a row is.
 * Items nobody has judged sit at the start rating, exactly as on a personal board.
 */
export function pooledLeaderboard(all: ResultsFile[], pool: Item[]): LeaderboardRow[] {
  return pool
    .map((item) => {
      const entries = all
        .map((r) => r.ratings[item.id])
        .filter((e): e is EloEntry => !!e && e.games > 0);

      if (!entries.length) return { item, entry: blankEntry(item.id), rankerCount: 0 };

      const games = entries.reduce((sum, e) => sum + e.games, 0);
      const weighted = entries.reduce((sum, e) => sum + e.rating * e.games, 0);
      return {
        item,
        entry: {
          itemId: item.id,
          rating: Math.round(weighted / games),
          wins: entries.reduce((sum, e) => sum + e.wins, 0),
          losses: entries.reduce((sum, e) => sum + e.losses, 0),
          games,
        },
        rankerCount: entries.length,
      };
    })
    .sort(byRating);
}

/** Best first. Ties break toward the more-judged item, so a settled row outranks a
 *  coincidentally-equal one that nobody has really tested. */
function byRating(a: LeaderboardRow, b: LeaderboardRow): number {
  return b.entry.rating - a.entry.rating || b.entry.games - a.entry.games;
}
