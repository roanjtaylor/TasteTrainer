// A photo that shows the WHOLE image (object-contain) instead of cropping it
// (object-cover). To avoid empty letterbox bars, a blurred, zoomed copy of the same
// image fills the background — so the gaps blend smoothly into the picture rather
// than showing flat dead space. Used by every display/review card so portrait and
// landscape images both render fully and consistently.
//
// Both img tags share the same src so the browser only makes one network request;
// the blur copy is served from the in-memory image cache. loading="lazy" defers
// off-screen images so the page renders fast and only fetches what's visible.
export function Photo({
  src,
  alt,
  className = '',
}: {
  src?: string;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center text-sm text-[var(--color-muted)] ${className}`}
      >
        needs image
      </div>
    );
  }
  return (
    <div className={`relative h-full w-full overflow-hidden ${className}`}>
      {/* Blurred fill behind: same URL — browser serves the blur from cache. */}
      <img
        src={src}
        alt=""
        aria-hidden
        loading="lazy"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl"
      />
      {/* The real image, shown in full. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="relative h-full w-full object-contain"
      />
    </div>
  );
}
