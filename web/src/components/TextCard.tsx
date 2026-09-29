import type { Item } from '../../../shared/types';
import { ScaledTile } from './TweetCard';

// The card for an item that is only words (Item.text — the Poems dataset). Same contract
// as TweetCard and InstagramCard: a fixed 4:3 tile on the wall, one click to open. There
// is no picture and no back — the text is the whole item, attribution and dates included —
// so the tile is just the text, and the open view is the same text at reading size,
// scrolling if it runs long.

export function TextCard({ item, onOpen }: { item: Item; onOpen: (rect: DOMRect) => void }) {
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
        aria-label={item.name || 'Show text'}
        className="aspect-[4/3] w-full cursor-pointer overflow-hidden hover:bg-[var(--color-wall-soft)]"
      >
        <ScaledTile stacked={false}>
          <div className="h-full p-4">
            <p className="serif h-full overflow-hidden whitespace-pre-line text-[15px] leading-snug">{item.text}</p>
          </div>
        </ScaledTile>
      </div>
    </figure>
  );
}

/** The open text — shared by the app's modal, the slideshow and the embed widget's slide. */
export function TextView({ text }: { text: string }) {
  return (
    <p className="serif mx-auto max-w-xl whitespace-pre-line text-lg leading-relaxed text-[var(--color-ink)]">{text}</p>
  );
}
