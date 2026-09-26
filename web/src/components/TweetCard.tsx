import { useState, type ReactNode } from 'react';
import type { Item, Tweet } from '../../../shared/types';
import { NativeTweet } from './NativeTweet';

// The card for an item that is a saved thread (Item.tweet — server/services/tweets.ts).
//
// Same contract as ItemCard — a fixed 4:3 tile on the wall, one click to open — so the
// grid treats the two alike. What differs is what there is to show: a tweet's picture
// IS its words, so the tile is the lead tweet's text rather than a photo, and opening it
// unfolds the whole thread in order instead of a description.
//
// The closed tile is drawn from the stored text: a wall of hundreds has to paint at once,
// and an iframe per card wouldn't. Opened, each tweet that has an id becomes X's real
// embed (NativeTweet.tsx), with the stored copy standing in until it loads — and for
// good if the original is gone. Pictures are hotlinked from X, never copied.
//
// A thread of more than one tweet reads as a COLLECTION, not a single card: its closed
// tile is a small hand of cards — the lead tweet in front, the next one or two fanned
// out behind it from a shared bottom hinge, spreading slightly on hover. (The look the
// subtopic fans on the old Filters page had.) It stays inside the same 4:3 cell, so the
// wall's grid doesn't know the difference.
export function TweetCard({
  item,
  expanded,
  onToggle,
  onEdit,
}: {
  item: Item;
  expanded: boolean;
  onToggle: () => void;
  onEdit?: () => void;
}) {
  const tweets = item.tweet?.tweets ?? [];
  const own = tweets.filter((t) => !t.context);
  // The tile shows where the thread starts, so opening it reads straight on.
  const lead = own[0] ?? tweets[0];
  const stacked = own.length > 1;
  const CARD = 'overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]';
  // The box every card of the hand shares: inset far enough that a fanned corner never
  // leaves the cell, whatever the zoom.
  const HAND = 'absolute inset-x-[5%] bottom-0 top-[9%] origin-bottom';

  return (
    <figure className={expanded || !stacked ? CARD : 'group relative aspect-[4/3]'}>
      {!expanded && stacked &&
        own.slice(1, 3).map((t, i) => (
          <div
            key={t.id || i}
            aria-hidden
            style={{ zIndex: i }}
            className={`${HAND} ${CARD} shadow-sm transition-transform duration-200 ${
              i === 0 ? '-rotate-[4deg] group-hover:-rotate-[5deg]' : 'rotate-[4deg] group-hover:rotate-[5deg]'
            }`}
          />
        ))}
      {!expanded && (
        <div
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
          aria-expanded={false}
          aria-label="Show thread"
          className={`cursor-pointer overflow-hidden hover:bg-[var(--color-wall-soft)] ${
            stacked ? `${HAND} ${CARD} z-10 shadow-sm` : 'aspect-[4/3] w-full'
          }`}
        >
          <ScaledTile stacked={stacked}>
            <div className="flex h-full flex-col gap-2 p-4">
              <Byline tweet={lead} fallback={item} />
              {/* min-h-0 lets the text be the part that gives way, so the footer always fits. */}
              <p className="serif min-h-0 flex-1 overflow-hidden whitespace-pre-line text-[15px] leading-snug">
                {lead?.text ?? item.name}
              </p>
              <p className="flex shrink-0 items-center justify-between text-xs text-[var(--color-muted)]">
                {stacked ? (
                  <span className="rounded-full bg-[var(--color-ink)]/80 px-2.5 py-0.5 text-[var(--color-wall)]">
                    +{own.length - 1} more
                  </span>
                ) : (
                  <span>{item.subtopic}</span>
                )}
                <span>{item.year ?? ''}</span>
              </p>
            </div>
          </ScaledTile>
        </div>
      )}

      {expanded && (
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={onToggle}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            >
              ← Close
            </button>
            <div className="flex items-center gap-3 text-xs">
              {onEdit && (
                <button onClick={onEdit} className="text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                  Edit
                </button>
              )}
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent)] hover:underline"
                >
                  Open on X ↗
                </a>
              )}
            </div>
          </div>
          <TweetThreadList tweets={tweets} fallback={item} />
        </div>
      )}
    </figure>
  );
}

// The closed tile is laid out once at a fixed design size and then scaled by the wall's
// `--tile-scale` variable (set once per zoom step on the grid in DatasetView), so zooming
// shrinks the tile like a picture — nothing re-measures or re-wraps per tile. A stacked
// hand's front card is 90% of the cell wide, so its design size is 90% of the plain one.
export const TILE_W = 320;
const TILE_H = 240;

function ScaledTile({ stacked, children }: { stacked: boolean; children: ReactNode }) {
  return (
    <div
      className="origin-top-left"
      style={{
        width: stacked ? TILE_W * 0.9 : TILE_W,
        height: stacked ? TILE_H * 0.91 : TILE_H,
        transform: 'scale(var(--tile-scale, 1))',
      }}
    >
      {children}
    </div>
  );
}

/** What a tweet falls back on when it carries no author of its own: the item it
 *  belongs to. Structural so the embed widget's slimmer items (EmbedItem) fit too. */
type Fallback = Pick<Item, 'name' | 'brand'> & { creator?: string };

/** The open thread, oldest first — shared with the embed widget's tweet slide.
 *
 * A single tweet (no thread at all) gets X's real embed (NativeTweet) for full
 * fidelity — verified badge, video, live like count. A THREAD (more than one tweet)
 * instead reads as one connected column, the way X itself shows a thread: one avatar
 * rail with a line running through it, not a stack of separately-bordered cards. X's
 * own widget can't do that — each `createTweet` call draws its own independent,
 * self-bordered iframe, so stitching several of them into one continuous thread isn't
 * possible — so a thread is drawn entirely from the stored copy instead (the same data
 * NativeTweet falls back on for a single tweet).
 *
 * `plain` (the embed's slide) drops the byline's own link to X — the whole row becomes
 * the link instead, and a link can't nest inside a link. */
export function TweetThreadList({
  tweets,
  fallback,
  plain,
}: {
  tweets: Tweet[];
  fallback: Fallback;
  plain?: boolean;
}) {
  if (tweets.length <= 1) {
    const only = tweets[0];
    if (!only) return null;
    return (
      <ol>
        <SingleTweet tweet={only} fallback={fallback} plain={plain} />
      </ol>
    );
  }
  return (
    <ol className="flex flex-col">
      {tweets.map((t, i) => (
        <ThreadRow
          key={t.id || i}
          tweet={t}
          fallback={fallback}
          plain={plain}
          last={i === tweets.length - 1}
        />
      ))}
    </ol>
  );
}

function SingleTweet({ tweet, fallback, plain }: { tweet: Tweet; fallback: Fallback; plain?: boolean }) {
  const stored = (
    <div className="flex gap-2.5">
      <Avatar tweet={tweet} fallback={fallback} size={32} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Byline tweet={tweet} fallback={fallback} dated bare link={!plain} />
        <p className="whitespace-pre-line break-words text-sm leading-snug">{tweet.text}</p>
        {tweet.media?.map((src) => (
          <img key={src} src={src} alt="" loading="lazy" className="w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
  const body = tweet.id ? <NativeTweet id={tweet.id}>{stored}</NativeTweet> : stored;
  return <li>{linkable(body, tweet, plain)}</li>;
}

/** One row of a connected thread: an avatar on a rail, a line running from it down to
 *  the next tweet's avatar (nothing below the last), and the tweet's own text beside
 *  it — no card border, no boxed background, so consecutive rows read as one column
 *  rather than a stack of separate tweets. A tweet only present as reply-chain
 *  context (not itself liked) recedes at lower opacity, same as before. */
function ThreadRow({
  tweet,
  fallback,
  plain,
  last,
}: {
  tweet: Tweet;
  fallback: Fallback;
  plain?: boolean;
  last: boolean;
}) {
  const row = (
    <div className={`flex gap-2.5 ${tweet.context ? 'opacity-60' : ''}`}>
      <div className="flex shrink-0 flex-col items-center">
        <Avatar tweet={tweet} fallback={fallback} size={32} />
        {!last && <div className="my-1 w-0.5 flex-1 rounded-full bg-[var(--color-line)]" />}
      </div>
      <div className={`min-w-0 flex-1 space-y-1.5 ${last ? '' : 'pb-4'}`}>
        <Byline tweet={tweet} fallback={fallback} dated bare link={!plain} />
        <p className="whitespace-pre-line break-words text-sm leading-snug">{tweet.text}</p>
        {tweet.media?.map((src) => (
          <img key={src} src={src} alt="" loading="lazy" className="w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
  return <li>{linkable(row, tweet, plain)}</li>;
}

/** `plain` wraps a tweet in its own link to X (the embed's tap-to-open); otherwise the
 *  byline's own link already covers it. */
function linkable(body: ReactNode, tweet: Tweet, plain?: boolean) {
  if (!plain || !tweet.id) return body;
  return (
    <a
      href={`https://x.com/${tweet.author || 'i'}/status/${tweet.id}`}
      target="_blank"
      rel="noreferrer"
      className="block"
    >
      {body}
    </a>
  );
}

// The author's face, as on X: round, left of the name. Hotlinked, so it can vanish (the
// author changed it, or the tweet came in by hand with none) — an initial stands in.
function Avatar({ tweet, fallback, size }: { tweet?: Tweet; fallback: Fallback; size: number }) {
  const [broken, setBroken] = useState(false);
  const label = tweet?.authorName || tweet?.author || fallback.creator || '?';
  const box = { width: size, height: size };
  return tweet?.avatar && !broken ? (
    <img
      src={tweet.avatar}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      style={box}
      className="shrink-0 rounded-full bg-[var(--color-wall-soft)] object-cover"
    />
  ) : (
    <span
      aria-hidden
      style={box}
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--color-wall-soft)] text-xs font-medium text-[var(--color-muted)]"
    >
      {label.replace(/^@/, '').charAt(0).toUpperCase()}
    </span>
  );
}

/** `bare` leaves the avatar to the caller (the open thread hangs it beside the whole
 *  tweet); otherwise it leads the line, with the name stacked over the handle. */
function Byline({
  tweet,
  fallback,
  dated,
  bare,
  link = true,
}: {
  tweet?: Tweet;
  fallback: Fallback;
  dated?: boolean;
  bare?: boolean;
  /** false when an ancestor is already the tweet's link to X — a link can't nest
   *  inside another link. */
  link?: boolean;
}) {
  const name = tweet?.authorName || (tweet?.context ? '' : fallback.creator);
  const handle = tweet?.author ? `@${tweet.author}` : tweet?.context ? '' : fallback.brand;
  const date = dated && tweet?.createdAt ? formatDate(tweet.createdAt) : '';
  if (!bare) {
    return (
      <div className="flex shrink-0 items-center gap-2.5">
        <Avatar tweet={tweet} fallback={fallback} size={36} />
        <p className="min-w-0 text-xs leading-tight text-[var(--color-muted)]">
          <span className="block truncate text-sm font-medium text-[var(--color-ink)]">
            {name || handle || 'Unknown'}
          </span>
          {name && handle && <span className="block truncate">{handle}</span>}
        </p>
      </div>
    );
  }
  const inner = (
    <>
      <span className="truncate font-medium text-[var(--color-ink)]">{name || handle || 'Unknown'}</span>
      {name && handle && <span className="truncate">{handle}</span>}
      {date && <span className="shrink-0">· {date}</span>}
    </>
  );
  const cls = 'flex items-baseline gap-1.5 text-xs text-[var(--color-muted)]';
  // In the open thread each tweet links to itself, so any one of them can be opened on
  // X — not just the one the card as a whole points at.
  return tweet?.id && link ? (
    <a
      href={`https://x.com/${tweet.author || 'i'}/status/${tweet.id}`}
      target="_blank"
      rel="noreferrer"
      className={`${cls} hover:underline`}
    >
      {inner}
    </a>
  ) : (
    <p className={cls}>{inner}</p>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
