import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DOMAINS, DOMAIN_LABELS, slugifyTopic, type Domain } from '../../../shared/types';
import { useDatasetList } from '../lib/data';
import { EMBED_CONFIG_MESSAGE, EMBED_MODE_MESSAGE, EMBED_READY_MESSAGE } from '../lib/embedProtocol';

// The embed widget, previewed the way it'll sit on someone else's site (/iframe). Two
// switches, both kept in the URL so a view is linkable and survives a reload:
//   ?device=mobile|desktop — the frame is a fixed size for each, not draggable; the
//                            toggle for it lives in the nav (EmbedTesterButton).
//   ?mode=edit|view        — (toggle in the nav, under the device one) this page plays
//                            the role of a website builder hosting the widget: it tells
//                            the frame which mode to be in (lib/embedProtocol.ts), and in
//                            edit mode saves what the frame reports back.
export const DEVICE_SIZES = {
  mobile: { width: 390, height: 585 },
  desktop: { width: 800, height: 480 },
} as const;
export type Device = keyof typeof DEVICE_SIZES;

export function useDevice(): [Device, (d: Device) => void] {
  const [params, setParams] = useSearchParams();
  const device: Device = params.get('device') === 'mobile' ? 'mobile' : 'desktop';
  const set = (d: Device) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set('device', d); return n; }, { replace: true });
  return [device, set];
}

export function useEditMode(): [boolean, (edit: boolean) => void] {
  const [params, setParams] = useSearchParams();
  const set = (edit: boolean) =>
    setParams((p) => { const n = new URLSearchParams(p); n.set('mode', edit ? 'edit' : 'view'); return n; }, { replace: true });
  return [params.get('mode') !== 'view', set];
}

export function IframeTester() {
  const [params, setParams] = useSearchParams();
  const [device] = useDevice();
  const [editing] = useEditMode();
  const worldParam = params.get('world');
  const world: Domain | null = (DOMAINS as readonly string[]).includes(worldParam ?? '') ? (worldParam as Domain) : null;
  const topic = world ? (params.get('topic') ?? '') : '';

  // What the widget's edit panel last asked for; cleared when the device switches.
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => setSize(null), [device]);

  // The frame is a fixed size per device, but never taller than what's left of the
  // window below the nav — the page must fit without scrolling. The embed code below
  // reports the size actually rendered, so the snippet is always what you're looking at.
  const boxRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Infinity);
  useEffect(() => {
    const measure = () => {
      const top = boxRef.current?.getBoundingClientRect().top ?? 0;
      // box padding + border (34) and the page's own bottom padding (32)
      setRoom(Math.floor(window.innerHeight - top - 34 - 32));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const { data: datasets } = useDatasetList(world ?? 'physical');
  const topics = world ? (datasets ?? []).map((d) => ({ label: d.topic, slug: slugifyTopic(d.topic) })) : [];
  const update = (patch: Record<string, string | null>) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      for (const [k, v] of Object.entries(patch)) (v ? n.set(k, v) : n.delete(k));
      return n;
    }, { replace: true });
  const width = size?.width ?? DEVICE_SIZES[device].width;
  const height = size?.height ?? Math.max(360, Math.min(DEVICE_SIZES[device].height, room));

  const origin = window.location.origin;
  const src = `${origin}/embed${world && topic ? `/${world}/${topic}` : ''}`;
  const code = `<iframe id="tt-embed" src="${src}" width="${width}" height="${height}" style="border:0;border-radius:12px" loading="lazy"></iframe>`;

  // ---- Acting as the host editor: the wiring a website builder does ----
  const hostRef = useRef<HTMLDivElement>(null);
  const frameWindow = () => hostRef.current?.querySelector('iframe')?.contentWindow ?? null;
  const sendMode = () => frameWindow()?.postMessage({ type: EMBED_MODE_MESSAGE, mode: 'view' }, origin);
  const sendModeRef = useRef(sendMode);
  sendModeRef.current = sendMode;


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
        if (d.width > 0 && d.height > 0) setSize({ width: d.width, height: d.height });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [setParams]);

  // What a website builder's custom component needs, in full.
  const wiring = `<script>
var f = document.getElementById('tt-embed');
var MODE = 'view';
function send() {
  f.contentWindow.postMessage(
    { type: '${EMBED_MODE_MESSAGE}', mode: MODE }, '${origin}');
}
// Call this whenever your editor flips this element: setMode('edit') / setMode('view')
function setMode(m) { MODE = m; send(); }
addEventListener('message', function (e) {
  if (e.source !== f.contentWindow) return;
  var d = e.data || {};
  if (d.type === '${EMBED_READY_MESSAGE}') send();
  if (d.type === '${EMBED_CONFIG_MESSAGE}') {
    save(d.src);            // YOUR code: store d.src as this element's setting
    f.width = d.width;
    f.height = d.height;
  }
});
</script>`;

  const field = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 py-1.5 font-mono text-[10px] leading-snug';
  const ctl = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 py-1 text-xs';
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  const btn = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 text-xs hover:bg-[var(--color-wall-soft)]';

  return (
    <div className="flex flex-col items-center">
      {/* One bordered "host page": the embed exactly as an importer's snippet renders it
          (the code is injected verbatim, not a lookalike); in edit mode the settings lay
          over the frame itself. The frame stays in view mode here so
          it's pixel-for-pixel what visitors get; the in-frame settings panel is what a
          builder's editor gets by flipping the mode (see the Editor wiring). */}
      <div ref={boxRef} className="flex max-w-full items-start gap-4 overflow-x-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-wall-soft)] p-4 shadow-sm">
        <div className="relative shrink-0 overflow-hidden rounded-xl" style={{ width, height }}>
          <div ref={hostRef} key={code} className="[&_iframe]:block" dangerouslySetInnerHTML={{ __html: code }} />
          {/* Edit mode lays over the frame — same size, nothing pushed aside. The scrim
              swallows pointer events so the widget underneath isn't hoverable or
              clickable while editing; the panel is the right half on desktop and the
              whole frame on mobile. */}
          {editing && <div className="absolute inset-0 bg-black/25" />}
        {editing && (
          <aside
            className={`absolute inset-y-0 right-0 space-y-2.5 overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-card)] p-3 text-xs shadow-lg ${
              device === 'mobile' ? 'left-0 w-full border-l-0' : 'w-1/2'
            }`}
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Settings</h3>
            <label className="block space-y-1">
              <span className="font-semibold">World</span>
              <select className={ctl} value={world ?? ''} onChange={(e) => update({ world: e.target.value || null, topic: null })}>
                <option value="">Visitor picks (no fixed topic)</option>
                {DOMAINS.map((d) => (
                  <option key={d} value={d}>{DOMAIN_LABELS[d].title}</option>
                ))}
              </select>
            </label>
            {world && (
              <label className="block space-y-1">
                <span className="font-semibold">Topic</span>
                <select className={ctl} value={topic} onChange={(e) => update({ topic: e.target.value || null })}>
                  <option value="">{datasets ? 'Visitor picks a topic' : 'Loading…'}</option>
                  {topics.map((t) => (
                    <option key={t.slug} value={t.slug}>{t.label}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="flex gap-2">
              {(['width', 'height'] as const).map((k) => (
                <label key={k} className="block min-w-0 flex-1 space-y-1">
                  <span className="font-semibold capitalize">{k} (px)</span>
                  <input
                    type="number"
                    min={k === 'width' ? 220 : 160}
                    step={10}
                    className={ctl}
                    value={k === 'width' ? width : height}
                    onChange={(e) => {
                      const v = Math.round(Number(e.target.value));
                      if (v > 0) setSize({ width, height, [k]: v });
                    }}
                  />
                </label>
              ))}
            </div>
            <details className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)]">
              <summary className="cursor-pointer px-3 py-1.5 font-semibold">Embed code</summary>
              <div className="space-y-2 px-3 pb-3">
                <textarea readOnly value={code} wrap="off" className={`${field} h-16`} />
                <button onClick={() => copy(code)} className={btn}>Copy embed code</button>
              </div>
            </details>
            <details className="rounded-lg border border-[var(--color-line)] bg-[var(--color-card)]">
              <summary className="cursor-pointer px-3 py-1.5 font-semibold">Editor wiring</summary>
              <div className="space-y-2 px-3 pb-3">
                <p className="text-xs text-[var(--color-muted)]">
                  For a website builder: the frame starts in view mode and your editor flips it — the URL can't.
                </p>
                <textarea readOnly value={wiring} wrap="off" className={`${field} h-40`} />
                <button onClick={() => copy(wiring)} className={btn}>Copy wiring</button>
              </div>
            </details>
          </aside>
        )}
        </div>
      </div>
    </div>
  );
}
