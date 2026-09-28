import type { Dataset, InstagramImportStats, InstagramPost, InstagramPostRef, Item } from '../../../shared/types.ts';
import { newId, now } from '../util.ts';

// Liked and saved Instagram posts, from Instagram's own data export
// (your_instagram_activity/likes/liked_posts.json and saved/saved_posts.json), folded into
// a personal dataset. Unlike the tweet import (tweets.ts) nothing is fetched: the export
// already carries the link, caption, owner and hashtags, and the one thing it lacks — when
// the post was published — is decoded from the link itself. Media is never copied; the
// app shows Instagram's own embed of the post (web/src/components/InstagramCard.tsx).

// ---- The shortcode ----

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Instagram's snowflake epoch, ms: the value a media id's timestamp bits count from. */
const IG_EPOCH_MS = 1314220021721n;

/** instagram.com/reel/<code>/ or /p/<code>/ — the code and which kind of link it was. */
export function parseLink(url: string): { shortcode: string; kind: InstagramPost['kind'] } | null {
  const m = /instagram\.com\/(reel|reels|p|tv)\/([A-Za-z0-9_-]{5,20})/.exec(url);
  if (!m) return null;
  return { shortcode: m[2], kind: m[1] === 'p' ? 'post' : 'reel' };
}

/**
 * A shortcode is the post's media id in Instagram's base-64 alphabet, and a media id is a
 * snowflake: the top bits are the publish time in ms since IG_EPOCH_MS. Checked against
 * the export: every decoded date lands before the like or save that followed it.
 */
export function publishedAt(shortcode: string): string {
  let id = 0n;
  // A media id is 11 characters; the longer codes some links carry (20, on a private
  // account's posts) are that id followed by a share suffix, which is not part of it.
  for (const c of shortcode.slice(0, 11)) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) return '';
    id = id * 64n + BigInt(v);
  }
  const ms = Number((id >> 23n) + IG_EPOCH_MS);
  const d = new Date(ms);
  // Anything outside Instagram's lifetime is a code that isn't a media id at all.
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 2010 || d.getTime() > Date.now() + 86_400_000) return '';
  return d.toISOString();
}

// ---- The export's text ----

/**
 * Instagram writes its export as UTF-8 bytes escaped one byte at a time ("â\u0080\u0099"
 * for a curly apostrophe), so read naively every non-ASCII character is mojibake. If the
 * whole string fits in one byte per character, reading it as bytes and decoding as UTF-8
 * gets the text back; a string that doesn't decode is left as it came.
 */
export function fixEncoding(text: string): string {
  if (!/[\u0080-ÿ]/.test(text) || /[Ā-￿]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return text;
  }
}

function iso(seconds: number | undefined): string | undefined {
  if (!seconds || !Number.isFinite(seconds)) return undefined;
  return new Date(seconds * 1000).toISOString();
}

// ---- Items ----

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  // By code point, not UTF-16 unit: slicing inside a surrogate pair (an emoji, a
  // mathematical-bold letter) leaves a lone half that PostgREST rejects as invalid JSON.
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join("").trimEnd()}…`;
}

/** What the ref becomes; null when its link carries no shortcode. */
export function postFromRef(ref: InstagramPostRef): InstagramPost | null {
  const link = parseLink(ref.url ?? '');
  if (!link) return null;
  const owner = fixEncoding(ref.owner ?? '').replace(/^@/, '').trim();
  const likedAt = iso(ref.likedAt);
  const savedAt = iso(ref.savedAt);
  return {
    shortcode: link.shortcode,
    kind: link.kind,
    caption: fixEncoding(ref.caption ?? '').trim(),
    owner,
    ownerName: fixEncoding(ref.ownerName ?? '').trim(),
    hashtags: [...new Set((ref.hashtags ?? []).map((h) => fixEncoding(h).replace(/^#/, '').trim()).filter(Boolean))],
    publishedAt: publishedAt(link.shortcode),
    ...(likedAt ? { likedAt } : {}),
    ...(savedAt ? { savedAt } : {}),
  };
}

export function postUrl(post: InstagramPost): string {
  return `https://www.instagram.com/${post.kind === 'post' ? 'p' : 'reel'}/${post.shortcode}/`;
}

/** The ordinary Item fields, derived from the post so browse/filter/rank need no special
 *  case. `keep` is the item being replaced: its identity and filing survive. */
export function itemFromPost(post: InstagramPost, keep?: Item): Item {
  const year = post.publishedAt ? new Date(post.publishedAt).getFullYear() : NaN;
  const who = post.ownerName || (post.owner ? `@${post.owner}` : '');
  return {
    id: keep?.id ?? newId(),
    name: truncate(post.caption, 80) || (who ? `${who} — ${post.kind}` : `Instagram ${post.kind}`),
    description: post.caption,
    image: '',
    year: Number.isFinite(year) ? year : (keep?.year ?? null),
    brand: post.owner ? `@${post.owner}` : (keep?.brand ?? ''),
    creator: post.ownerName || keep?.creator || '',
    definingFact: keep?.definingFact ?? '',
    subtopic: keep?.subtopic ?? '',
    url: postUrl(post),
    instagram: post,
    createdAt: keep?.createdAt ?? now(),
  };
}

// ---- Merging into the dataset ----

/**
 * Fold a batch of posts into a dataset. Safe to re-run, and meant to be: a post that is
 * already here (the same shortcode — 400-odd posts are in BOTH the likes and the saves
 * file) only gains the timestamp it was missing, and keeps whatever filing or notes it
 * has been given since.
 */
export function mergePosts(ds: Dataset, refs: InstagramPostRef[]): { dataset: Dataset; stats: InstagramImportStats } {
  const stats: InstagramImportStats = { added: 0, merged: 0, skipped: 0 };
  const items = [...ds.items];
  const byCode = new Map<string, number>();
  items.forEach((it, i) => {
    if (it.instagram) byCode.set(it.instagram.shortcode, i);
  });
  for (const ref of refs) {
    const post = postFromRef(ref);
    if (!post) {
      stats.skipped++;
      continue;
    }
    const at = byCode.get(post.shortcode);
    if (at === undefined) {
      byCode.set(post.shortcode, items.length);
      items.push(itemFromPost(post));
      stats.added++;
      continue;
    }
    const have = items[at];
    const old = have.instagram!;
    items[at] = {
      ...have,
      instagram: {
        ...old,
        // The export's fields fill whatever the stored copy lacks; a caption edited by
        // hand lives in `description`, which is left alone.
        caption: old.caption || post.caption,
        owner: old.owner || post.owner,
        ownerName: old.ownerName || post.ownerName,
        hashtags: old.hashtags.length ? old.hashtags : post.hashtags,
        publishedAt: old.publishedAt || post.publishedAt,
        ...(post.likedAt ? { likedAt: post.likedAt } : {}),
        ...(post.savedAt ? { savedAt: post.savedAt } : {}),
      },
    };
    stats.merged++;
  }
  return { dataset: { ...ds, items }, stats };
}
