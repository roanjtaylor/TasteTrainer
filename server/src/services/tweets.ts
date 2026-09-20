// Importing liked tweets into a personal dataset.
//
// The X data archive's like.js is a complete list of what you liked, but each entry is
// only an id and the text — no author, no date, no thread. This fills the rest in from
// X's public syndication endpoint (the one that powers embedded tweets; no API key),
// walks each like UP its author's reply chain so a liked tweet arrives as the whole
// thread that led to it, and merges likes from the same thread into one item.
//
// What it can't do: walk DOWN. The endpoint names a tweet's parent, never its replies,
// so a thread you liked only the first tweet of is saved as that first tweet. The card
// links out to X for the rest.
//
// The endpoint is undocumented and could change shape or disappear. That's acceptable
// for an importer — everything it returns is stored, so nothing already imported
// depends on it still working.
import { newId, now } from '../util.ts';
import type {
  Dataset,
  Item,
  LikedTweetRef,
  Tweet,
  TweetImportStats,
  TweetThread,
} from '../../../shared/types.ts';

const ENDPOINT = 'https://cdn.syndication.twimg.com/tweet-result';
/** How far up a reply chain to walk. Far longer than any real thread; a stop against a
 *  malformed chain looping, not a limit anyone should meet. */
const MAX_CHAIN = 60;
const CONCURRENCY = 4;

/** The slice of the endpoint's response this reads. */
interface RawTweet {
  __typename?: string;
  id_str?: string;
  text?: string;
  created_at?: string;
  display_text_range?: [number, number];
  in_reply_to_status_id_str?: string;
  user?: { screen_name?: string; name?: string };
  entities?: {
    urls?: { url: string; expanded_url?: string }[];
    media?: { url: string }[];
  };
  mediaDetails?: { media_url_https?: string }[];
  parent?: RawTweet;
  quoted_tweet?: RawTweet;
}

interface Fetched {
  tweet: Tweet;
  parentId: string;
  /** The endpoint embeds the immediate parent, which saves every other request. */
  parent: Fetched | null;
  quoted: Tweet | null;
}

/** A tweet that is gone (deleted, protected, suspended) — distinct from a request that
 *  merely failed, which must stay retryable rather than be recorded as missing. */
const GONE = 'gone' as const;

// The token the embed script sends. Derived from the id, not a secret.
function tokenFor(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// The raw text carries what the timeline hides: the "@a @b " a reply starts with, a
// trailing t.co link standing in for attached media, and t.co in place of every real
// url. `display_text_range` is in code points, hence Array.from.
function cleanText(raw: RawTweet): string {
  let text = raw.text ?? '';
  if (raw.display_text_range) {
    const [start, end] = raw.display_text_range;
    text = Array.from(text).slice(start, end).join('');
  }
  for (const m of raw.entities?.media ?? []) text = text.split(m.url).join('');
  for (const u of raw.entities?.urls ?? []) {
    if (u.expanded_url) text = text.split(u.url).join(u.expanded_url);
  }
  return decodeEntities(text).trim();
}

function toTweet(raw: RawTweet): Tweet {
  const media = (raw.mediaDetails ?? []).map((m) => m.media_url_https ?? '').filter(Boolean);
  return {
    id: raw.id_str ?? '',
    text: cleanText(raw),
    author: raw.user?.screen_name ?? '',
    authorName: raw.user?.name ?? '',
    createdAt: raw.created_at ?? '',
    liked: false,
    ...(media.length ? { media } : {}),
  };
}

function toFetched(raw: RawTweet): Fetched {
  return {
    tweet: toTweet(raw),
    parentId: raw.in_reply_to_status_id_str ?? '',
    parent: raw.parent?.id_str ? toFetched(raw.parent) : null,
    quoted: raw.quoted_tweet?.id_str ? { ...toTweet(raw.quoted_tweet), context: true } : null,
  };
}

async function fetchTweet(id: string): Promise<Fetched | typeof GONE> {
  const url = `${ENDPOINT}?id=${id}&token=${tokenFor(id)}&lang=en`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.status === 404) return GONE;
    if (res.ok) {
      const raw = (await res.json()) as RawTweet;
      if (raw.__typename !== 'Tweet' || !raw.id_str) return GONE;
      return toFetched(raw);
    }
    if (attempt >= 2) throw new Error(`X returned ${res.status} for tweet ${id}`);
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

type FetchCache = Map<string, Promise<Fetched | typeof GONE>>;

function cachedFetch(id: string, cache: FetchCache): Promise<Fetched | typeof GONE> {
  let hit = cache.get(id);
  if (!hit) {
    hit = fetchTweet(id);
    cache.set(id, hit);
  }
  return hit;
}

/** The liked tweet plus everything above it by the same author, and — where that chain
 *  starts as a reply to somebody else, or quotes them — that one tweet as context. */
async function resolveThread(id: string, cache: FetchCache): Promise<TweetThread | typeof GONE> {
  const liked = await cachedFetch(id, cache);
  if (liked === GONE) return GONE;
  const author = liked.tweet.author.toLowerCase();
  const chain: Tweet[] = [liked.tweet];
  const context: Tweet[] = liked.quoted ? [liked.quoted] : [];
  let cur = liked;
  while (cur.parentId && chain.length < MAX_CHAIN) {
    // A parent that can't be read ends the walk; the thread is just shorter for it.
    const parent = cur.parent ?? (await cachedFetch(cur.parentId, cache).catch(() => GONE));
    if (parent === GONE) break;
    if (parent.tweet.author.toLowerCase() !== author) {
      context.push({ ...parent.tweet, context: true });
      break;
    }
    chain.unshift(parent.tweet);
    if (parent.quoted) context.push(parent.quoted);
    cur = parent;
  }
  return { tweets: [...context, ...chain] };
}

// ---- Merging into the dataset ----

/** What two copies of the same tweet's text still share after the archive's leading
 *  @mentions and t.co links, or a hand paste's whitespace, are taken out of it. */
function textKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^(\s*@\w+)+/, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 60);
}

function byId(a: Tweet, b: Tweet): number {
  if (!a.id || !b.id) return 0;
  const [x, y] = [BigInt(a.id), BigInt(b.id)];
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Context first, then the author's own chain — each oldest first (ids are chronological). */
function ordered(tweets: Tweet[]): Tweet[] {
  return [
    ...tweets.filter((t) => t.context).sort(byId),
    ...tweets.filter((t) => !t.context).sort(byId),
  ];
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The ordinary Item fields, derived from the thread so browse/filter/rank need no
 *  special case. `keep` is the item being replaced: its identity and filing survive. */
export function itemFromThread(thread: TweetThread, keep?: Item): Item {
  const own = thread.tweets.filter((t) => !t.context);
  // Named for, and linked to, where the thread STARTS: a thread reads from its first
  // tweet, and on X that is the link that opens the whole of it.
  const root = own[0] ?? thread.tweets[0];
  const lead = root;
  const year = root?.createdAt ? new Date(root.createdAt).getFullYear() : NaN;
  return {
    id: keep?.id ?? newId(),
    name: truncate(lead?.text ?? '', 80),
    description: own.map((t) => t.text).join('\n\n'),
    image: own.flatMap((t) => t.media ?? [])[0] ?? '',
    year: Number.isFinite(year) ? year : (keep?.year ?? null),
    brand: root?.author ? `@${root.author}` : (keep?.brand ?? ''),
    creator: root?.authorName || keep?.creator || '',
    definingFact: keep?.definingFact ?? '',
    subtopic: keep?.subtopic ?? '',
    url: lead?.id ? `https://x.com/${lead.author || 'i'}/status/${lead.id}` : (keep?.url ?? ''),
    tweet: thread,
    createdAt: keep?.createdAt ?? now(),
  };
}

async function pooled<T, R>(inputs: T[], limit: number, fn: (input: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, inputs.length) }, async () => {
      while (next < inputs.length) {
        const i = next++;
        results[i] = await fn(inputs[i]);
      }
    }),
  );
  return results;
}

/**
 * Fold a batch of likes into a dataset. Safe to re-run: a like already present is
 * skipped without a request, so an import interrupted halfway is resumed by simply
 * importing the same file again.
 */
export async function mergeLikes(
  ds: Dataset,
  likes: LikedTweetRef[],
): Promise<{ dataset: Dataset; stats: TweetImportStats }> {
  const stats: TweetImportStats = { added: 0, merged: 0, skipped: 0, unavailable: 0, failed: 0 };
  let items = [...ds.items];

  const find = (id: string) => items.find((it) => it.tweet?.tweets.some((t) => t.id === id));

  // Likes the dataset already holds cost nothing. One that's present only as thread
  // filler (pulled in above some other like) just gets its flag set.
  const fresh: LikedTweetRef[] = [];
  const seen = new Set<string>();
  for (const like of likes) {
    if (seen.has(like.id)) continue;
    seen.add(like.id);
    const holder = find(like.id);
    if (!holder?.tweet) {
      fresh.push(like);
      continue;
    }
    const tweet = holder.tweet.tweets.find((t) => t.id === like.id)!;
    if (tweet.liked) {
      stats.skipped++;
      continue;
    }
    tweet.liked = true;
    items = items.map((it) => (it === holder ? itemFromThread(holder.tweet!, holder) : it));
    stats.merged++;
  }

  const cache: FetchCache = new Map();
  const resolved = await pooled(fresh, CONCURRENCY, async (like) => {
    try {
      return { like, thread: await resolveThread(like.id, cache) };
    } catch {
      return { like, thread: null };
    }
  });

  for (const { like, thread: result } of resolved) {
    if (result === null) {
      stats.failed++;
      continue;
    }
    let thread: TweetThread;
    if (result === GONE) {
      // Deleted since you liked it. The archive's copy of the text is all that's left
      // of it — which is the case for keeping the text at all. A bare pasted link has
      // no such copy, so there is nothing to save.
      if (!like.text?.trim()) {
        stats.failed++;
        continue;
      }
      stats.unavailable++;
      thread = {
        tweets: [{ id: like.id, text: like.text.trim(), author: '', authorName: '', createdAt: '', liked: true }],
      };
    } else {
      thread = result;
      for (const t of thread.tweets) if (t.id === like.id) t.liked = true;
    }

    // Everything already saved that this thread belongs with: an item sharing any of
    // its tweets, and any hand-pasted item (tweets with no id yet) whose text it matches.
    const ids = new Set(thread.tweets.map((t) => t.id));
    const keys = new Set(thread.tweets.map((t) => textKey(t.text)).filter(Boolean));
    const absorbed = items.filter((it) => {
      if (!it.tweet) return false;
      if (it.tweet.tweets.some((t) => t.id && ids.has(t.id))) return true;
      const pasted = it.tweet.tweets.filter((t) => !t.id);
      return pasted.length > 0 && pasted.every((t) => keys.has(textKey(t.text)));
    });

    const merged = new Map<string, Tweet>(thread.tweets.map((t) => [t.id, { ...t }]));
    for (const old of absorbed.flatMap((it) => it.tweet!.tweets)) {
      // A pasted tweet has no id to merge on; its match in the fetched thread is found
      // by text and inherits the like. The fetched copy is otherwise the better one.
      const match = old.id
        ? merged.get(old.id)
        : [...merged.values()].find((t) => textKey(t.text) === textKey(old.text));
      if (match) {
        match.liked ||= old.liked;
        // A deleted tweet known from a paste keeps the author/date the paste gave it.
        match.author ||= old.author;
        match.authorName ||= old.authorName;
        match.createdAt ||= old.createdAt;
      } else merged.set(old.id || `pasted:${textKey(old.text)}`, { ...old });
    }

    const keep = absorbed[0];
    const item = itemFromThread({ tweets: ordered([...merged.values()]) }, keep);
    if (keep) {
      items = items.filter((it) => !absorbed.includes(it) || it === keep).map((it) => (it === keep ? item : it));
      stats.merged++;
    } else {
      items.push(item);
      stats.added++;
    }
  }

  return { dataset: { ...ds, items }, stats };
}
