import type { Item, Tweet } from '../../../shared/types';

// The card for an item that is a saved thread (Item.tweet — server/services/tweets.ts).
//
// Same contract as ItemCard — a fixed 4:3 tile on the wall, one click to open — so the
// grid treats the two alike. What differs is what there is to show: a tweet's picture
// IS its words, so the tile is the lead tweet's text rather than a photo, and opening it
// unfolds the whole thread in order instead of a description.
//
// Drawn from the stored text rather than X's embed script: it opens instantly, matches
// the rest of the wall, and still reads after the original is deleted. Pictures are
// hotlinked from X, never copied.
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
  return (
    <li className={`space-y-1.5 border-l-2 pl-3 ${tone}`}>
      <Byline tweet={tweet} fallback={fallback} dated />
      <p className="whitespace-pre-line break-words text-sm leading-snug">{tweet.text}</p>
      {tweet.media?.map((src) => (
        <img key={src} src={src} alt="" loading="lazy" className="w-full rounded-lg" />
      ))}
    </li>
  );
}

function Byline({ tweet, fallback, dated }: { tweet?: Tweet; fallback: Item; dated?: boolean }) {
  const name = tweet?.authorName || (tweet?.context ? '' : fallback.creator);
  const handle = tweet?.author ? `@${tweet.author}` : tweet?.context ? '' : fallback.brand;
  const date = dated && tweet?.createdAt ? formatDate(tweet.createdAt) : '';
  const inner = (
    <>
      <span className="truncate font-medium text-[var(--color-ink)]">{name || handle || 'Unknown'}</span>
      {name && handle && <span className="truncate">{handle}</span>}
      {date && <span className="shrink-0">· {date}</span>}
    </>
  );
  const cls = 'flex shrink-0 items-baseline gap-1.5 text-xs text-[var(--color-muted)]';
  // In the open thread each tweet links to itself, so any one of them can be opened on
  // X — not just the one the card as a whole points at.
  return dated && tweet?.id ? (
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
