import type { Item } from '../../../shared/types';

// When an item is from, as finely as it's known. The researched worlds know a year;
// a saved tweet or an Instagram post knows the day it was published, and a wall of
// them has to read in that order, not shuffled within each year. Anything undated
// sorts last, as it always has.
export function itemTime(item: Pick<Item, 'year' | 'tweet' | 'instagram'>): number {
  const iso =
    item.instagram?.publishedAt ||
    item.tweet?.tweets.find((t) => !t.context)?.createdAt ||
    item.tweet?.tweets[0]?.createdAt;
  if (iso) {
    const t = new Date(iso).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return item.year == null ? Infinity : Date.UTC(item.year, 0, 1);
}

export function byItemTime(a: Item, b: Item): number {
  return itemTime(a) - itemTime(b);
}
