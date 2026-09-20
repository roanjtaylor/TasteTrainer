import { memo, useEffect, useState } from 'react';
import { thumbSrcSet } from '../lib/image';

/** The slot a Photo fills when the caller doesn't say: one card of the item grid. */
const CARD_SIZES = '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw';

// A photo that shows the WHOLE image (object-contain) instead of cropping it
// (object-cover). To avoid empty letterbox bars, a blurred, zoomed copy of the same
// image fills the background — so the gaps blend smoothly into the picture rather
// than showing flat dead space. Used by every display/review card so portrait and
// landscape images both render fully and consistently.
//
// Both img tags share the same src/srcset/sizes so the browser picks the same file
// for each and only makes one network request; the blur copy is served from the
// in-memory image cache. loading="lazy" defers off-screen images so the page renders
// fast and only fetches what's visible; decoding="async" keeps a big decode off the
// main thread so scrolling and panning don't hitch while pictures arrive.
//
// `sizes` is how wide the photo is drawn (a CSS `sizes` value). With it the browser
// fetches a version of the picture about that wide instead of the stored one, where
// the host can resize (lib/image.ts) — the difference between 20KB and 1MB per tile.
//
// memo: a parent that re-renders on every pointer move (Mosaic's pan/zoom) would
// otherwise re-render hundreds of these for props that haven't changed.
export const Photo = memo(function Photo({
  src,
  alt,
  className = '',
  sizes = CARD_SIZES,
}: {
  src?: string;
  alt: string;
  className?: string;
  sizes?: string;
}) {
  // A resized version that fails to load (a file narrower than the width asked for, a
  // format Wikimedia won't thumbnail) falls back to the stored URL, exactly as before.
  const [plain, setPlain] = useState(false);
  useEffect(() => setPlain(false), [src]);

  if (!src) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center text-sm text-[var(--color-muted)] ${className}`}
      >
        needs image
      </div>
    );
  }
  const srcSet = plain ? undefined : thumbSrcSet(src);
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {/* Blurred fill behind: same URL — browser serves the blur from cache. */}
      <img
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        draggable={false}
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl"
      />
      {/* The real image, shown in full. draggable=false: without it the browser's
          native "drag this image" gesture grabs the pointer first, which is what was
          silently swallowing Mosaic's own drag-to-pan handling. */}
      <img
        src={src}
        srcSet={srcSet}
        sizes={srcSet ? sizes : undefined}
        alt={alt}
        loading="lazy"
        decoding="async"
        draggable={false}
        onError={srcSet ? () => setPlain(true) : undefined}
        className="relative h-full w-full object-contain"
      />
    </div>
  );
});
