import { useState } from 'react';
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
          className={`flex cursor-pointer flex-col gap-2 overflow-hidden p-4 hover:bg-[var(--color-wall-soft)] ${
            stacked ? `${HAND} ${CARD} z-10 shadow-sm` : 'aspect-[4/3] w-full'
          }`}
        >
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

/** What a tweet falls back on when it carries no author of its own: the item it
 *  belongs to. Structural so the embed widget's slimmer items (EmbedItem) fit too. */
type Fallback = Pick<Item, 'name' | 'brand'> & { creator?: string };

/** The open thread, oldest first — shared with the embed widget's tweet slide. */
export function TweetThreadList({ tweets, fallback }: { tweets: Tweet[]; fallback: Fallback }) {
  return (
    <ol className="space-y-3">
      {tweets.map((t, i) => (
        <ThreadTweet key={t.id || i} tweet={t} fallback={fallback} />
      ))}
    </ol>
  );
}

function ThreadTweet({ tweet, fallback }: { tweet: Tweet; fallback: Fallback }) {
  // The liked tweets are why the thread is here; the rest is what they were said in
  // reply to. The accent rule marks the former, and context is set back further still.
  const tone = tweet.context
    ? 'border-[var(--color-line)] opacity-70'
    : tweet.liked
      ? 'border-[var(--color-accent)]'
      : 'border-[var(--color-line)]';
  // Our own drawing of the stored tweet. For a tweet with an id it is what shows while
  // X's real embed loads, and what stays if that never arrives (NativeTweet.tsx).
  const stored = (
    <div className="flex gap-2.5">
      <Avatar tweet={tweet} fallback={fallback} size={32} />
      <div className="min-w-0 flex-1 space-y-1.5">
        <Byline tweet={tweet} fallback={fallback} dated bare />
        <p className="whitespace-pre-line break-words text-sm leading-snug">{tweet.text}</p>
        {tweet.media?.map((src) => (
          <img key={src} src={src} alt="" loading="lazy" className="w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
  return (
    <li className={`border-l-2 pl-3 ${tone}`}>
      {tweet.id ? <NativeTweet id={tweet.id}>{stored}</NativeTweet> : stored}
    </li>
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
}: {
  tweet?: Tweet;
  fallback: Fallback;
  dated?: boolean;
  bare?: boolean;
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
  return tweet?.id ? (
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
