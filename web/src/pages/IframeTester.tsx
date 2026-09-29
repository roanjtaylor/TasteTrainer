import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DOMAINS, type Domain } from '../../../shared/types';
import { EMBED_CONFIG_MESSAGE, EMBED_MODE_MESSAGE, EMBED_READY_MESSAGE } from '../lib/embedProtocol';

// The embed widget, previewed the way it'll sit on someone else's site (/iframe).
// One switch, kept in the URL so a view is linkable and survives a reload:
//   ?mode=edit|view — (toggle in the nav, EmbedTesterButton) this page plays the role of
//                     a website builder hosting the widget: it tells the frame which
//                     mode to be in (lib/embedProtocol.ts), and saves what the frame's
//                     own settings panel reports back (world/topic into the URL, the
//                     size onto the frame).
// There's no phone preset: the frame is never wider than the page, so narrowing the
// browser window is how a phone-sized embed is previewed.
const DEFAULT_SIZE = { width: 800, height: 480 };

export function useEditMode(): [boolean, (edit: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const set = (edit: boolean) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set('mode', edit ? 'edit' : 'view'); return n; }, { replace: true });
  return [params.get('mode') !== 'view', set];
}

export function IframeTester() {
  const [params, setParams] = useSearchParams();
  const [editing] = useEditMode();
  const worldParam = params.get('world');
  const world: Domain | null = (DOMAINS as readonly string[]).includes(worldParam ?? '') ? (worldParam as Domain) : null;
  const topic = world ? (params.get('topic') ?? '') : '';

  // What the widget's edit panel last asked for.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // The frame is a fixed size, but never wider than the page's column or taller than
  // what's left of the window below the nav — the page must fit without scrolling, and
  // a narrowed window is a narrowed frame. The embed code reports the size actually
  // rendered, so the snippet is always what you're looking at.
  const boxRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Infinity);
  const [roomWidth, setRoomWidth] = useState(Infinity);
  useEffect(() => {
    const measure = () => {
      const top = boxRef.current?.getBoundingClientRect().top ?? 0;
      // the outline (4, both sides) and the page's own bottom padding (32)
      setRoom(Math.floor(window.innerHeight - top - 4 - 32));
      const column = boxRef.current?.parentElement?.clientWidth;
      if (column) setRoomWidth(column - 4);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  // A width typed into the widget's panel is capped too: the frame never overflows the page.
  const width = Math.max(220, Math.min(size?.width ?? DEFAULT_SIZE.width, roomWidth));
  const height = size?.height ?? Math.max(360, Math.min(DEFAULT_SIZE.height, room));
  const rendered = useRef({ width, height });
  rendered.current = { width, height };

  const origin = window.location.origin;
  const src = `${origin}/embed${world && topic ? `/${world}/${topic}` : ''}`;
  // Injected once per src, not per size: re-injecting would reload the widget on every
  // resize of the window. The box around it sizes it instead (the CSS beats the
  // attributes), so the numbers here are only where it starts.
  const code = useMemo(
    () => `<iframe id="tt-embed" src="${src}" width="${rendered.current.width}" height="${rendered.current.height}" style="border:0;border-radius:12px" loading="lazy"></iframe>`,
    [src],
  );

  // ---- Acting as the host editor: the wiring a website builder does ----
  // The frame's own edit mode is the one previewed here — the same panel a builder's
  // editor gets — so the mode sent is the real one, and re-sent whenever it flips.
  const hostRef = useRef<HTMLDivElement>(null);
  const frameWindow = () => hostRef.current?.querySelector('iframe')?.contentWindow ?? null;
  const sendMode = () =>
    frameWindow()?.postMessage({ type: EMBED_MODE_MESSAGE, mode: editing ? 'edit' : 'view' }, origin);
  const sendModeRef = useRef(sendMode);
  sendModeRef.current = sendMode;
  useEffect(() => sendModeRef.current(), [editing]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frameWindow()) return;
      const d = e.data ?? {};
      if (d.type === EMBED_READY_MESSAGE) sendModeRef.current();
      if (d.type === EMBED_CONFIG_MESSAGE) {
        setParams((p) => {
          const n = new URLSearchParams(p);
          if (d.world && d.topic) { n.set('world', d.world); n.set('topic', d.topic); }
          else { n.delete('world'); n.delete('topic'); }
          return n;
        }, { replace: true });
        // The panel also reports the size it opened at — the one already rendered. Only
        // a size actually typed is kept, so the frame goes on following the window.
        const cur = rendered.current;
        if (d.width > 0 && d.height > 0 && (d.width !== cur.width || d.height !== cur.height)) {
          setSize({ width: d.width, height: d.height });
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setParams]);

  return (
    <div className="flex flex-col items-center">
      {/* The embed exactly as an importer's snippet renders it (the code is injected
          verbatim, not a lookalike), outlined in black on its own edge: everything
          inside the line is the iframe, nothing outside it is. In edit mode the frame is
          told so and draws its own settings panel (Embed.tsx EditPanel) — settings,
          embed code and editor wiring, all in that one column inside the frame. Nothing
          is drawn from out here, so the frame is the same size in both modes and what's
          previewed is exactly what a builder's editor gets. */}
      <div ref={boxRef} className="mt-0.5 max-w-full">
        <div className="relative outline outline-2 outline-black" style={{ width, height }}>
          <div ref={hostRef} key={code} className="h-full w-full [&_iframe]:block [&_iframe]:h-full [&_iframe]:w-full" dangerouslySetInnerHTML={{ __html: code }} />
        </div>
      </div>
    </div>
  );
}
