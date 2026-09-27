// The "genie" open/close animation shared by every place a tapped tile grows into a
// full picture and shrinks back into it on close (Embed.tsx's mosaic -> solo picture,
// and ItemModal's mosaic -> full-screen view). A uniform scale + a clip that opens up
// as it grows, so nothing stretches and the tile's edges are what "unfurl" — the same
// trick a map or dock icon uses. Web Animations API, so it can be played in reverse
// and tells the caller when it's done.
export type GenieOrigin = { x: number; y: number; w: number; h: number };

export function playGenie(
  el: HTMLElement,
  origin: GenieOrigin,
  frame: { w: number; h: number },
  direction: 'open' | 'close',
  onDone?: () => void,
) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onDone?.();
    return;
  }
  const { w: W, h: H } = frame;
  const s = Math.max(origin.w / W, origin.h / H) || 1;
  const dx = origin.x + origin.w / 2 - W / 2;
  const dy = origin.y + origin.h / 2 - H / 2;
  const ix = Math.max(0, (W - origin.w / s) / 2);
  const iy = Math.max(0, (H - origin.h / s) / 2);
  const tile = { transform: `translate(${dx}px, ${dy}px) scale(${s})`, clipPath: `inset(${iy}px ${ix}px round ${8 / s}px)` };
  const full = { transform: 'translate(0px, 0px) scale(1)', clipPath: 'inset(0px 0px round 0px)' };
  const opening = direction === 'open';
  const frames = opening ? [tile, full] : [full, tile];
  const anim = el.animate(frames, {
    duration: opening ? 460 : 340,
    easing: opening ? 'cubic-bezier(0.34, 1.25, 0.5, 1)' : 'cubic-bezier(0.55, 0, 0.3, 1)',
    fill: opening ? 'none' : 'forwards',
  });
  anim.onfinish = () => onDone?.();
}
