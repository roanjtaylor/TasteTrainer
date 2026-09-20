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

  return (
    <figure className="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)]">
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
          className="flex aspect-[4/3] w-full cursor-pointer flex-col gap-2 overflow-hidden p-4 hover:bg-[var(--color-wall-soft)]"
        >
          <Byline tweet={lead} fallback={item} />
          {/* min-h-0 lets the text be the part that gives way, so the footer always fits. */}
          <p className="serif min-h-0 flex-1 overflow-hidden whitespace-pre-line text-[15px] leading-snug">
            {lead?.text ?? item.name}
          </p>
          <p className="flex shrink-0 justify-between text-xs text-[var(--color-muted)]">
            <span>{own.length > 1 ? `Thread · ${own.length} tweets` : item.subtopic}</span>
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
          <ol className="space-y-3">
            {tweets.map((t, i) => (
              <ThreadTweet key={t.id || i} tweet={t} fallback={item} />
            ))}
          </ol>
        </div>
      )}
    </figure>
  );
}

function ThreadTweet({ tweet, fallback }: { tweet: Tweet; fallback: Item }) {
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
function Avatar({ tweet, fallback, size }: { tweet?: Tweet; fallback: Item; size: number }) {
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
  fallback: Item;
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
