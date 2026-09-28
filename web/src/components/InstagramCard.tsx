import { useEffect, useRef, useState } from 'react';
import type { InstagramPost, Item } from '../../../shared/types';
import { ScaledTile } from './TweetCard';

// The card for an item that is a liked or saved Instagram post (Item.instagram —
// server/services/instagram.ts). Same contract as TweetCard: a fixed 4:3 tile on the
// wall, drawn from the stored caption so a wall of hundreds paints at once, and one
// click to open it full-screen (TweetModal, grown out of this tile).
//
// Opened, the post is Instagram's own embed (InstagramEmbed below) — the real thing in
// an iframe: the reel plays, a carousel swipes, the photo is the photo. The export
// carries no media, so there is nothing of our own to draw in its place; the stored
// caption stays underneath as the copy that survives a deleted post.

const KIND_LABEL: Record<InstagramPost['kind'], string> = { reel: 'Reel', post: 'Post' };

export function postUrl(post: InstagramPost): string {
  return `https://www.instagram.com/${post.kind === 'post' ? 'p' : 'reel'}/${post.shortcode}/`;
}

/** Owner as shown: the display name, else the handle, else what the item says. */
function who(post: InstagramPost, fallback: Pick<Item, 'name' | 'brand'> & { creator?: string }): { name: string; handle: string } {
  return {
    name: post.ownerName || fallback.creator || '',
    handle: post.owner ? `@${post.owner}` : fallback.brand,
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InstagramCard({ item, onOpen }: { item: Item; onOpen: (rect: DOMRect) => void }) {
  const post = item.instagram!;
  const owner = who(post, item);
  return (
    <figure className="overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)]">
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => onOpen(e.currentTarget.getBoundingClientRect())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen(e.currentTarget.getBoundingClientRect());
          }
        }}
        aria-haspopup="dialog"
        aria-label={`Show ${KIND_LABEL[post.kind].toLowerCase()}`}
        className="aspect-[4/3] w-full cursor-pointer overflow-hidden hover:bg-[var(--color-wall-soft)]"
      >
        <ScaledTile stacked={false}>
          <div className="flex h-full flex-col gap-2 p-4">
            <div className="flex shrink-0 items-center gap-2.5">
              <Initial label={owner.name || owner.handle} size={36} />
              <p className="min-w-0 text-xs leading-tight text-[var(--color-muted)]">
                <span className="block truncate text-sm font-medium text-[var(--color-ink)]">
                  {owner.name || owner.handle || 'Unknown'}
                </span>
                {owner.name && owner.handle && <span className="block truncate">{owner.handle}</span>}
              </p>
            </div>
            <p className="serif min-h-0 flex-1 overflow-hidden whitespace-pre-line text-[15px] leading-snug">
              {post.caption || item.name}
            </p>
            <p className="flex shrink-0 items-center justify-between text-xs text-[var(--color-muted)]">
              <span className="rounded-full border border-[var(--color-line)] px-2 py-0.5">{KIND_LABEL[post.kind]}</span>
              <span>{post.publishedAt ? formatDate(post.publishedAt) : (item.year ?? '')}</span>
            </p>
          </div>
        </ScaledTile>
      </div>
    </figure>
  );
}

function Initial({ label, size }: { label: string; size: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-[var(--color-wall-soft)] text-xs font-medium text-[var(--color-muted)]"
    >
      {(label || '?').replace(/^@/, '').charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Instagram's own embed of the post — the same iframe its official embed script writes,
 * addressed directly so no third-party script has to run on our page. Instagram sizes
 * it by posting a MEASURE message from inside the frame (what embed.js listens for), so
 * the frame starts at a plausible height and takes Instagram's own as soon as it arrives.
 */
export function InstagramEmbed({ post }: { post: InstagramPost }) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(post.kind === 'reel' ? 900 : 700);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== 'https://www.instagram.com' || e.source !== frame.current?.contentWindow) return;
      try {
        const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        const h = Number(data?.details?.height);
        if (data?.type === 'MEASURE' && h > 100) setHeight(h);
      } catch {
        /* not one of Instagram's */
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      key={post.shortcode}
      src={`${postUrl(post)}embed/captioned/`}
      title={`Instagram ${KIND_LABEL[post.kind].toLowerCase()}`}
      allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
      allowFullScreen
      loading="lazy"
      scrolling="no"
      style={{ height }}
      className="block w-full max-w-[540px] rounded-md border border-[var(--color-line)] bg-white"
    />
  );
}

/** The open post — shared by the app's modal, the slideshow and the embed widget's
 *  slide. Instagram's embed, then the stored copy in a line beneath: who, when, and
 *  whether you liked it, saved it, or both. */
export function InstagramPostView({
  item,
}: {
  item: Pick<Item, 'name' | 'brand' | 'instagram'> & { creator?: string };
}) {
  const post = item.instagram;
  if (!post) return null;
  const owner = who(post, item);
  const marks = [post.likedAt && 'Liked', post.savedAt && 'Saved'].filter(Boolean).join(' · ');
  return (
    <div className="mx-auto flex max-w-[540px] flex-col items-stretch gap-2">
      <InstagramEmbed post={post} />
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-[var(--color-muted)]">
        <a href={postUrl(post)} target="_blank" rel="noreferrer" className="truncate font-medium text-[var(--color-ink)] hover:underline">
          {owner.name || owner.handle || 'Unknown'}
        </a>
        {owner.name && owner.handle && <span className="truncate">{owner.handle}</span>}
        {post.publishedAt && <span>· {formatDate(post.publishedAt)}</span>}
        {marks && <span>· {marks}</span>}
      </p>
    </div>
  );
}
