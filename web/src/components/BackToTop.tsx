import { useEffect, useRef, useState } from 'react';

// How far down the page before the button appears — short pages never show it, so it
// only ever offers to solve a scroll that's actually annoying to do by hand.
const SHOW_AFTER_PX = 600;

const CONFETTI_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

/** One burst of confetti from a screen point, drawn on a full-viewport canvas that
 *  removes itself once every particle has faded — no persistent DOM, no library. */
function burstConfetti(originX: number, originY: number) {
  const canvas = document.createElement('canvas');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none;';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  const particles = Array.from({ length: 90 }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 9;
    return {
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 4, // biased upward so the burst reads as "launched"
      size: 4 + Math.random() * 5,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.4,
      life: 1,
    };
  });

  let raf = 0;
  function tick() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of particles) {
      p.vy += 0.18; // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.spin;
      p.life -= 0.012;
      if (p.life <= 0) continue;
      alive = true;
      ctx!.save();
      ctx!.globalAlpha = Math.max(p.life, 0);
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rotation);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx!.restore();
    }
    if (alive) {
      raf = requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  }
  raf = requestAnimationFrame(tick);

  // Safety net — if the tab is backgrounded mid-burst, rAF stalls rather than firing,
  // so the canvas would otherwise sit inert (but still pointer-events:none, harmless)
  // until the tab regains focus. Cap it so it's gone either way.
  setTimeout(() => {
    cancelAnimationFrame(raf);
    canvas.remove();
  }, 4000);
}

/** Fixed bottom-right "back to top" button — appears once you've scrolled past
 *  `SHOW_AFTER_PX`, so it's only ever there when the top is actually far away. */
export function BackToTop() {
  const [visible, setVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > SHOW_AFTER_PX);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      ref={btnRef}
      onClick={() => {
        const rect = btnRef.current?.getBoundingClientRect();
        burstConfetti(
          rect ? rect.left + rect.width / 2 : window.innerWidth - 48,
          rect ? rect.top + rect.height / 2 : window.innerHeight - 48,
        );
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      aria-label="Back to top"
      title="Back to top"
      className="fixed bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:shadow-xl"
    >
      ↑
    </button>
  );
}
