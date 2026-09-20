import { useEffect, useRef, useState, type ReactNode } from 'react';

// X's own embedded tweet — the real thing, drawn by X inside an iframe: verified badge,
// playable video, link cards, live like counts. Needs only the tweet's id.
//
// It is an upgrade over the stored copy, never a replacement for it: `children` (our own
// rendering of the saved text) shows immediately, and is swapped out only once X's
// version has actually drawn. A tweet that's been deleted, a blocked script, or no
// connection all leave the stored copy standing — which is the reason to store it.

interface Twttr {
  ready?: (cb: (t: Twttr) => void) => void;
  widgets: {
    createTweet: (
      id: string,
      el: HTMLElement,
      options: Record<string, unknown>,
    ) => Promise<HTMLElement | undefined>;
  };
}

let script: Promise<Twttr> | null = null;

/** X's widgets script, loaded once and only when a thread is first opened — the wall
 *  of closed cards never pays for it. */
function loadWidgets(): Promise<Twttr> {
  script ??= new Promise<Twttr>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://platform.twitter.com/widgets.js';
    el.async = true;
    el.onload = () => {
      const twttr = (window as unknown as { twttr?: Twttr }).twttr;
      if (!twttr) return reject(new Error('X widgets unavailable'));
      if (twttr.ready) twttr.ready(resolve);
      else resolve(twttr);
    };
    el.onerror = () => {
      script = null; // let a later open try again
      reject(new Error('X widgets blocked'));
    };
    document.head.append(el);
  });
  return script;
}

export function NativeTweet({ id, children }: { id: string; children: ReactNode }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    setDrawn(false);
    loadWidgets()
      .then((twttr) =>
        twttr.widgets.createTweet(id, el, {
          // The thread is already laid out tweet by tweet; without this every reply
          // would repeat its parent above itself.
          conversation: 'none',
          dnt: true,
          align: 'center',
        }),
      )
      // Resolves with nothing when X has no such tweet any more.
      .then((made) => {
        if (cancelled) made?.remove();
        else setDrawn(!!made);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      el.replaceChildren();
    };
  }, [id]);

  return (
    <>
      {/* X sizes its iframe to this box; the negative margin cancels the 10px it adds
          above and below, so a thread of them stacks as tightly as our own copy does. */}
      <div ref={holder} className={drawn ? '-my-2.5' : 'h-0 overflow-hidden'} />
      {!drawn && children}
    </>
  );
}
