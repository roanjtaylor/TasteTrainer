import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { EMBED_CONFIG_MESSAGE, EMBED_MODE_MESSAGE, EMBED_READY_MESSAGE } from '../lib/embedProtocol';
import { DOMAINS, DOMAIN_LABELS, slugifyTopic } from '../../../shared/types';
import type { DatasetSummary, Domain, EmbedDataset } from '../../../shared/types';
import * as db from '../lib/db';
import { Misconfigured, SignIn, useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { domainOf } from '../lib/domain';
import { EmbedChromeProvider } from '../lib/inEmbed';
import { NavActionsProvider } from '../lib/navActions';
import { EmbedBrowse } from '../components/EmbedBrowse';
import { AppRoutes, PAGE_GRID } from '../AppRoutes';

// Every world, the personal one included. A personal topic marked private reads as
// absent until the viewer signs in (row level security, lib/db.ts), so the widget
// puts its sign-in form up in place of the collection (the `signin` step below).
const WORLDS = DOMAINS;

/** What the iframe's address pins the widget to: one dataset (`/embed/:domain/:slug`,
 *  or `/embed/:datasetId`), or nothing — the bare `/embed`, where the visitor browses. */
interface Pin {
  domain?: string;
  /** A slug or a dataset id — db.getEmbed takes either. */
  slug: string;
}

function readPin(): Pin | null {
  const [, , first, second] = window.location.pathname.split('/');
  if (!first) return null;
  return second ? { domain: first, slug: second } : { slug: first };
}

type Step =
  | { kind: 'loading' }
  /** Nothing came back and nobody's signed in — it may be a private collection: show
   *  the sign-in form, then do `retry` once signed in. */
  | { kind: 'signin'; retry: () => void }
  | { kind: 'browse'; ds: EmbedDataset };

/**
 * The whole point of this page (main.tsx renders it instead of the app — no Nav, no
 * layout shell): a bare, iframeable, SELF-CONTAINED widget — `<iframe src=".../embed">`
 * on any other site, sized however the embedder likes.
 *
 * The bare `/embed` is the app itself minus its Nav (EmbedApp, below): the same
 * screens — pick a world, its map, a dataset — with a back arrow to climb out again.
 * `/embed/:domain/:slug` and `/embed/:datasetId` pin it to one dataset and show only
 * that, as the shuffle slideshow / mosaic (EmbedBrowse) — e.g. a permanent "wallpaper"
 * of one collection.
 */
export function Embed() {
  // The iframe's address is the widget's setting: read once, and only ever changed by
  // the settings panel (EditPanel), never by browsing.
  const [pin, setPin] = useState(readPin);
  // Edit mode is switched by the host page (lib/embedProtocol.ts), never by the URL, so
  // a visitor can't open the settings panel by editing the address. Starts in view.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.data?.type !== EMBED_MODE_MESSAGE) return;
      setEditing(e.data.mode === 'edit');
    };
    window.addEventListener('message', onMessage);
    // Asked after listening, so the host's answer can't arrive before we can hear it.
    if (window.parent !== window) window.parent.postMessage({ type: EMBED_READY_MESSAGE }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const repin = useCallback((path: string) => {
    window.history.replaceState(null, '', `/embed${path ? `/${path}` : ''}`);
    setPin(readPin());
  }, []);

  return (
    <>
      {pin ? <PinnedDataset key={pin.slug} slug={pin.slug} /> : <EmbedApp />}
      {editing && <EditPanel domainParam={pin?.domain} slug={pin?.domain ? pin.slug : ''} onRepin={repin} />}
    </>
  );
}

/** The bare widget: the app's own screens (AppRoutes), browsed in memory so a visitor
 *  clicking around never changes the iframe's address. */
function EmbedApp() {
  return (
    <MemoryRouter>
      {/* Screens that put buttons in the Nav (lib/navActions.tsx) find no slot here,
          so those buttons just don't draw. */}
      <NavActionsProvider>
        <EmbedFrame />
      </NavActionsProvider>
    </MemoryRouter>
  );
}

/** What stands in for the Nav: one arrow, up a level — to the world from a dataset, to
 *  the landing page from a world. Above a world or the landing page it takes a row of
 *  its own; over a dataset it floats, so the dataset keeps the whole frame. */
function EmbedFrame() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [ownsBack, setOwnsBack] = useState(false);

  const parts = pathname.split('/').filter(Boolean);
  const onDataset = !!domainOf(pathname) && parts.length === 2 && parts[1] !== 'new';
  // Kept stable per address: DatasetView hands `up` on to its widget browser.
  const chrome = useMemo(() => {
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length === 0) return { up: null, setOwnsBack };
    const upPath = `/${segments.slice(0, -1).join('/')}`;
    const upDomain = domainOf(upPath);
    const label = upDomain ? DOMAIN_LABELS[upDomain].short : 'TasteTrainer';
    return { up: { label, go: () => navigate(upPath) }, setOwnsBack };
  }, [pathname, navigate]);
  const { up } = chrome;

  const arrow = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
  const pill = 'rounded-full border border-[var(--color-line)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)] hover:text-[var(--color-ink)]';

  return (
    <EmbedChromeProvider value={chrome}>
      {up && !onDataset && (
        <div className={PAGE_GRID}>
          <div className="hidden lg:block" />
          <div className="flex h-10 items-end">
            <button onClick={up.go} className={`flex items-center gap-1 py-1 pl-2 pr-3 text-sm ${pill}`}>
              {arrow}
              <span className="serif">{up.label}</span>
            </button>
          </div>
        </div>
      )}
      {/* Over a dataset: a round arrow pinned top-left, which DatasetView leaves room
          for beside its title. */}
      {up && onDataset && !ownsBack && (
        <button
          onClick={up.go}
          aria-label={`Back to ${up.label}`}
          title={`Back to ${up.label}`}
          className={`fixed left-6 top-3 z-40 flex h-8 w-8 items-center justify-center shadow-sm lg:left-4 ${pill}`}
        >
          {arrow}
        </button>
      )}
      <div className={`${PAGE_GRID} pb-8 pt-5`}>
        <div className="hidden lg:block" />
        <main className="min-w-0">
          <AppRoutes />
        </main>
      </div>
    </EmbedChromeProvider>
  );
}

/** The widget pinned to one dataset: just its slideshow / mosaic, filling the frame. */
function PinnedDataset({ slug }: { slug: string }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [error, setError] = useState('');
  const { email } = useAuth();

  const open = useCallback(() => {
    setError('');
    db.getEmbed(slug)
      .then((ds) => {
        if (ds) setStep({ kind: 'browse', ds });
        else if (!email) setStep({ kind: 'signin', retry: open });
        else setError('Dataset not found');
      })
      .catch((e: Error) => setError(e.message ?? 'Could not load this'));
  }, [slug, email]);

  useEffect(() => {
    open();
    // Once per dataset; signing in retries through the `signin` step below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // Signing in (in the form the `signin` step shows) makes the call that was refused.
  useEffect(() => {
    if (step.kind === 'signin' && email) step.retry();
  }, [step, email]);

  if (error && step.kind !== 'browse') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-wall)] p-4 text-center text-sm text-[var(--color-muted)]">
        {error}
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[var(--color-wall)]">
      {step.kind === 'signin' && (
        <div className="h-full w-full overflow-y-auto">
          {supabase ? (
            <SignIn title="A private collection" blurb="Sign in to see what's here." />
          ) : (
            <Misconfigured />
          )}
        </div>
      )}
      {step.kind === 'browse' && <EmbedBrowse ds={step.ds} />}
    </div>
  );
}

// ---- Edit mode (set by the host, see lib/embedProtocol.ts): the settings panel, inside the iframe ----
// This IS what a website builder's editor shows (the /iframe tester flips the same mode,
// so it previews exactly this). A scrim over the widget, and the panel on the right half
// — or the whole frame when it's too narrow to split. Nothing here can be dismissed from
// inside: the host decides when editing ends, not the widget.
//
// The pickers are custom listboxes rather than native <select>s on purpose: builders
// zoom their canvas with `transform: scale()`, and Chromium positions a native select's
// popup wrongly for an iframe under a transformed ancestor (the list lands off to the
// side of the field). A list drawn in the panel's own DOM can't go anywhere else.
const NARROW_FRAME = 560;

function EditPanel({
  domainParam,
  slug,
  onRepin,
}: {
  domainParam?: string;
  slug: string;
  /** Re-points the iframe's own address: `world/slug`, or '' for the bare widget. */
  onRepin: (path: string) => void;
}) {
  const initialWorld = WORLDS.find((w) => w === domainParam) ?? '';
  const [world, setWorld] = useState<Domain | ''>(initialWorld);
  const [topics, setTopics] = useState<DatasetSummary[] | null>(null);
  const [width, setWidth] = useState(String(window.innerWidth));
  const [height, setHeight] = useState(String(window.innerHeight));
  const [narrow, setNarrow] = useState(window.innerWidth < NARROW_FRAME);
  // The personal world lists nothing until signed in; re-asked once that happens.
  const { email } = useAuth();

  useEffect(() => {
    setTopics(null);
    if (!world) return;
    db.listDatasets(world).catch(() => [] as DatasetSummary[]).then(setTopics);
  }, [world, email]);

  const post = useCallback(
    (size?: { width: number; height: number }) => {
      if (window.parent === window) return;
      const src = `${window.location.origin}/embed${slug ? `/${domainParam}/${slug}` : ''}`;
      window.parent.postMessage(
        {
          type: EMBED_CONFIG_MESSAGE,
          world: slug ? domainParam : null,
          topic: slug || null,
          src,
          width: size?.width ?? window.innerWidth,
          height: size?.height ?? window.innerHeight,
        },
        // The host's origin is unknowable from in here, and nothing in this is secret.
        '*',
      );
    },
    [domainParam, slug],
  );

  useEffect(() => post(), [post]);

  // The fields mirror the iframe's real size, so a host that resizes it by dragging
  // stays in sync with what's typed here.
  useEffect(() => {
    const onResize = () => {
      setWidth(String(window.innerWidth));
      setHeight(String(window.innerHeight));
      setNarrow(window.innerWidth < NARROW_FRAME);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  function commitSize() {
    const w = Math.round(Number(width));
    const h = Math.round(Number(height));
    if (w > 0 && h > 0) post({ width: w, height: h });
  }

  // A world without a topic is "visitor picks" — the src stays the generic /embed
  // (same as the tester's), the world only decides which topics are listed.
  function pickWorld(next: Domain | '') {
    setWorld(next);
    if (slug) onRepin('');
  }
  function pickTopic(nextSlug: string) {
    onRepin(nextSlug && world ? `${world}/${nextSlug}` : '');
  }

  const label = 'block text-[0.7rem] font-semibold text-[var(--color-muted)]';

  // The snippet and wiring live in this column with the settings — one panel is the
  // whole edit surface, and the frame is the same size in edit and view mode. They
  // read from the fields, so what's typed is what's copied.
  const origin = window.location.origin;
  const src = `${origin}/embed${slug ? `/${domainParam}/${slug}` : ''}`;
  const code = `<iframe id="tt-embed" src="${src}" width="${width}" height="${height}" style="border:0;border-radius:12px" loading="lazy"></iframe>`;
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
  const copy = (text: string) => void navigator.clipboard.writeText(text);
  const codeField = `${EDIT_FIELD} font-mono text-[10px] leading-snug`;
  const btn = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 text-xs hover:bg-[var(--color-wall-soft)]';

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/25" />
      <aside
        className={`fixed inset-y-0 right-0 z-50 space-y-2.5 overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-card)] p-3 text-xs shadow-lg ${
          narrow ? 'left-0 w-full border-l-0' : 'w-1/2'
        }`}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">Settings</h3>
        <div className="space-y-1">
          <label className={label} htmlFor="embed-world">World</label>
          <Dropdown
            id="embed-world"
            value={world}
            onChange={(v) => pickWorld(v as Domain | '')}
            options={[
              { value: '', label: 'Visitor picks (no fixed topic)' },
              ...WORLDS.map((w) => ({ value: w, label: DOMAIN_LABELS[w].title })),
            ]}
          />
        </div>
        {world && (
          <div className="space-y-1">
            <label className={label} htmlFor="embed-topic">Topic</label>
            <Dropdown
              id="embed-topic"
              value={world === domainParam ? slug : ''}
              disabled={topics === null}
              onChange={pickTopic}
              options={[
                {
                  value: '',
                  label:
                    topics === null
                      ? 'Loading…'
                      : world === 'personal' && !email
                        ? 'Sign in (in the widget) to list yours'
                        : 'Visitor picks a topic',
                },
                ...(topics ?? []).map((d) => ({ value: slugifyTopic(d.topic), label: d.topic })),
              ]}
            />
          </div>
        )}
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <label className={label} htmlFor="embed-width">Width (px)</label>
            <input id="embed-width" type="number" min={220} step={10} className={EDIT_FIELD} value={width}
              onChange={(e) => setWidth(e.target.value)} onBlur={commitSize}
              onKeyDown={(e) => e.key === 'Enter' && commitSize()} />
          </div>
          <div className="min-w-0 flex-1 space-y-1">
            <label className={label} htmlFor="embed-height">Height (px)</label>
            <input id="embed-height" type="number" min={160} step={10} className={EDIT_FIELD} value={height}
              onChange={(e) => setHeight(e.target.value)} onBlur={commitSize}
              onKeyDown={(e) => e.key === 'Enter' && commitSize()} />
          </div>
        </div>
        <details open className="rounded-lg border border-[var(--color-line)]">
          <summary className="cursor-pointer px-2 py-1.5 font-semibold">Embed code</summary>
          <div className="space-y-2 px-2 pb-2">
            <textarea readOnly value={code} wrap="off" className={`${codeField} h-16`} />
            <button type="button" onClick={() => copy(code)} className={btn}>Copy embed code</button>
          </div>
        </details>
        <details className="rounded-lg border border-[var(--color-line)]">
          <summary className="cursor-pointer px-2 py-1.5 font-semibold">Editor wiring</summary>
          <div className="space-y-2 px-2 pb-2">
            <p className="text-[var(--color-muted)]">
              For a website builder: the frame starts in view mode and your editor flips it — the URL can't.
            </p>
            <textarea readOnly value={wiring} wrap="off" className={`${codeField} h-40`} />
            <button type="button" onClick={() => copy(wiring)} className={btn}>Copy wiring</button>
          </div>
        </details>
      </aside>
    </>
  );
}

const EDIT_FIELD = 'w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-2 py-1 text-xs text-[var(--color-ink)]';

/** A select that draws its list in the panel's own DOM (see EditPanel for why not a
 *  native one). Closes on a click anywhere else or Escape. */
function Dropdown({
  id,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const current = options.find((o) => o.value === value) ?? options[0];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`${EDIT_FIELD} flex items-center justify-between gap-2 text-left disabled:opacity-50`}
      >
        <span className="truncate">{current?.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-[var(--color-muted)]">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] py-1 shadow-lg"
        >
          {options.map((o) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-[var(--color-wall-soft)] ${
                  o.value === value ? 'font-semibold text-[var(--color-ink)]' : 'text-[var(--color-ink)]/85'
                }`}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
