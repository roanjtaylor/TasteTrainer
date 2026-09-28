import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useSearchParams } from 'react-router-dom';
import type { Dataset, Domain, Item, ItemReport, Subtopic } from '../../../shared/types';
import { saveDataset, useDataset } from '../lib/data';
import * as db from '../lib/db';
import { SignIn, useAuth } from '../lib/auth';
import { useNarrow } from '../lib/narrow';
import { EmbedBrowse } from './Embed';
import { useChatView, useReportChatView } from '../lib/chatView';
import { physicalImageQuery } from '../lib/image';
import { ItemCard } from '../components/ItemCard';
import { ItemModal } from '../components/ItemModal';
import { TweetModal } from '../components/TweetModal';
import { ShuffleButton } from '../components/ShuffleButton';
import { Slideshow } from '../components/Slideshow';
import { TweetCard, TILE_W } from '../components/TweetCard';
import { InstagramCard } from '../components/InstagramCard';
import { InstagramImportPanel } from '../components/InstagramImportPanel';
import { byItemTime } from '../lib/itemDate';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';
import { BackToTop } from '../components/BackToTop';
import { PersonalFieldEditor } from '../components/PersonalFieldEditor';

// ---- Grid zoom ----
// The wall is always COLS cards across — the column structure never changes. Zooming
// scales the whole grid instead: it is `zoom` times as wide as the page column (so
// each card is drawn in full, just bigger or smaller, like the embed's mosaic), and
// once it is wider than the column you pan it sideways. 1 = the whole ten-wide wall
// fits; MAX_ZOOM = one card fills the row. Deliberately NOT persisted — every fresh
// load starts back at DEFAULT_ZOOM (three cards across), not wherever a previous
// session happened to leave it.
const COLS = 10;
const MIN_ZOOM = 1;
const MAX_ZOOM = COLS;
// Starts fully zoomed out (the whole ten-wide wall fits, no horizontal scrollbar) —
// the visitor zooms in deliberately, rather than landing on a pre-zoomed three-wide
// slice that needs a scrollbar just to see the rest of the wall.
const DEFAULT_ZOOM = MIN_ZOOM;

// The Dataset view (6-ui.md): the whole field as one wall, oldest first.
export function DatasetView() {
  // /physical/ships — the world and the field, both readable in the address bar.
  const { domain = '', slug = '' } = useParams();
  // Cached read: a dataset seen before paints immediately and corrects itself in the
  // background, so returning to it costs nothing (lib/store.ts).
  const { data: ds, error: loadError, set: setDs, refresh } = useDataset(slug || null);
  // Where Browse portals the personal world's Edit / Add actions: under the name.
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  // How the field is browsed: the whole wall at once, or one item at a time (shuffled or
  // in order) - the same two ways the embed offers.
  const [view, setView] = useState<'mosaic' | 'slideshow'>('slideshow');
  const [shuffle, setShuffle] = useState(true);
  // Tell the Claude dock what's on screen (lib/chatView.tsx).
  useReportChatView({ datasetId: ds?.id, datasetTopic: ds?.topic });

  // Chronological (undated last) by default: the one ordering that needs no labels to
  // read. `?order=newest` flips it; the arrow in the nav (Nav.tsx) toggles it. To the
  // day where the item knows it (a post's publish date), else the year (lib/itemDate.ts).
  const [params, setParams] = useSearchParams();
  const newestFirst = params.get('order') === 'newest';
  const pool = useMemo(() => {
    if (!ds) return [];
    const sorted = [...ds.items].sort(byItemTime);
    return newestFirst ? sorted.reverse() : sorted;
  }, [ds, newestFirst]);

  // A dataset that can't be read while nobody is signed in is most likely a private
  // one: row level security hides it rather than refusing it (lib/db.ts), so "not
  // found" and "private" look the same from here, and the sign-in form is the right
  // answer to both — and signing in re-makes the read that was refused (below: a
  // failed read leaves nothing in the cache, so nothing else would retry it). Only a
  // dataset marked private is ever gated; the personal world's shelf and its public
  // collections aren't (lib/auth.tsx).
  const { loading: authLoading, email } = useAuth();
  useEffect(() => {
    if (email && loadError) void refresh();
    // Only the sign-in itself should retry, not every render that still has the error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
  // On a phone the field is browsed exactly as the embed widget browses it
  // (EmbedBrowse, pages/Embed.tsx) — one mobile UI, defined once, rather than the
  // desktop wall's header, switches and margin actions squeezed into a narrow column.
  const narrow = useNarrow();

  if (loadError) {
    if (!email && !authLoading) {
      return <SignIn title={ds?.topic ?? 'A private collection'} blurb="Sign in to see what's here." />;
    }
    return <p className="mt-8 text-[var(--color-accent)]">{loadError}</p>;
  }
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  if (narrow) {
    return (
      // Full-bleed under the nav bar: cancels main's own padding (main.tsx) and takes
      // the rest of the viewport, so the widget's picture and utility bar sit exactly
      // where they would in a phone-sized iframe.
      <div className="-mx-6 -mt-5 -mb-8 h-[calc(100dvh-3.25rem)] overflow-hidden bg-[var(--color-wall)]">
        <EmbedBrowse
          key={ds.id}
          ds={db.toEmbedDataset(ds)}
          newestFirst={newestFirst}
          // `?view=mosaic` is only ever set here, and only read by the nav (Nav.tsx),
          // which shows the order arrow on a phone in the mosaic alone — the slideshow
          // has its own shuffle / oldest-first switch in the utility bar.
          onViewModeChange={(mode) =>
            setParams(
              (p) => {
                const n = new URLSearchParams(p);
                if (mode === 'mosaic') n.set('view', 'mosaic');
                else n.delete('view');
                return n;
              },
              { replace: true },
            )
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* This field's name, description and item count, pinned to the top-left for
          the whole scroll: on a long wall of images it's the one thing worth never
          losing. It's left-aligned in the margin beside the centred content column, so
          it sits alongside the grid rather than over it. Below md there's no margin to
          sit in, so it scrolls with the page like an ordinary heading. */}
      {/* Confined to the empty margin left of the content column (same maths as the grid in
          main.tsx), so long text wraps inside it instead of running over the cards. Only
          pinned from `lg`, where that margin exists. */}
      <div className="relative min-w-0 break-words lg:fixed lg:left-4 lg:top-3 lg:z-30 lg:w-[calc((100vw-min(72rem,74vw))/2-2rem)]">
        <h1 className="serif truncate text-xl leading-tight">
          {ds.topic}
        </h1>
        <p className="text-sm text-[var(--color-muted)]">
          {ds.description && `${ds.description} `}
          ({ds.items.length} {ds.items.length === 1 ? 'item' : 'items'})
        </p>
        <ViewSwitch view={view} onView={setView} shuffle={shuffle} onShuffle={setShuffle} />
        {/* Personal-world Edit / Add (filled by Browse). Desktop only: below md there's
            no left column to tidy them into. */}
        <div ref={setActionsSlot} className="mt-2 hidden gap-3 lg:flex" />
      </div>

      <ReportsPanel datasetId={ds.id} />

      <Browse
        ds={ds}
        pool={pool}
        view={view}
        shuffle={shuffle}
        actionsSlot={actionsSlot}
        onChanged={setDs}
      />

      <BackToTop />
    </div>
  );
}

// The left-column switch between the two ways of browsing: Mosaic (the whole wall) or
// Slideshow, whose Shuffle / Linear choice appears only while Slideshow is on.
function ViewSwitch({
  view,
  onView,
  shuffle,
  onShuffle,
}: {
  view: 'mosaic' | 'slideshow';
  onView: (v: 'mosaic' | 'slideshow') => void;
  shuffle: boolean;
  onShuffle: (on: boolean) => void;
}) {
  const seg = (active: boolean) =>
    `px-2.5 py-0.5 ${active ? 'bg-[var(--color-ink)] text-[var(--color-wall)]' : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'}`;
  const group = 'inline-flex overflow-hidden rounded-full border border-[var(--color-line)] text-xs';
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div className={group} role="group" aria-label="View">
        <button onClick={() => onView('mosaic')} aria-pressed={view === 'mosaic'} className={seg(view === 'mosaic')}>
          Mosaic
        </button>
        <button onClick={() => onView('slideshow')} aria-pressed={view === 'slideshow'} className={seg(view === 'slideshow')}>
          Slideshow
        </button>
      </div>
      {view === 'slideshow' && <ShuffleButton compact on={shuffle} onChange={onShuffle} />}
    </div>
  );
}

// ---- Reports: what visitors flagged from the public embed widget's card-back
// (Embed.tsx's flip), read straight from the table (lib/db.ts) — the curator alone
// can. Shown only while there's something open to look at — most datasets most of
// the time have nothing here, and an empty "0 reports" strip would just be permanent
// clutter. ----
function ReportsPanel({ datasetId }: { datasetId: string }) {
  const [reports, setReports] = useState<ItemReport[] | null>(null);
  const { ask, canAsk } = useChatView();

  useEffect(() => {
    let cancelled = false;
    db.listOpenReports(datasetId)
      .then((r) => {
        if (!cancelled) setReports(r);
      })
      .catch(() => {
        if (!cancelled) setReports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  async function dismiss(id: string) {
    // Optimistic: the curator has read it, whether or not the resolve write lands
    // before they move on.
    setReports((r) => r?.filter((x) => x.id !== id) ?? r);
    try {
      await db.deleteReport(id);
    } catch {
      /* stays dismissed in this view either way */
    }
  }

  if (!reports || reports.length === 0) return null;

  return (
    <div className="space-y-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/5 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
        {reports.length} reported {reports.length === 1 ? 'problem' : 'problems'}
      </p>
      <ul className="space-y-2">
        {reports.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{r.itemName || 'Untitled item'}</p>
              <p className="text-[var(--color-muted)]">{r.text}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              {canAsk && (
                <button
                  onClick={() => {
                    // Handing it to Claude counts as dealt with — leaving it in the
                    // list too would make the curator dismiss the same report twice.
                    ask(
                      `A visitor flagged a problem with "${r.itemName}" via the embed widget: "${r.text}". Please look into it and fix the dataset if something needs fixing.`,
                    );
                    dismiss(r.id);
                  }}
                  title="Ask Claude about this"
                  className="rounded-full border border-[var(--color-claude)]/60 px-3 py-1 text-xs text-[var(--color-claude)] hover:bg-[var(--color-wall-soft)]"
                >
                  Ask Claude
                </button>
              )}
              <button
                onClick={() => dismiss(r.id)}
                title="Dismiss this report"
                className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Browse ----
function Browse({
  ds,
  pool,
  view,
  shuffle,
  actionsSlot,
  onChanged,
}: {
  ds: Dataset;
  pool: Item[];
  view: 'mosaic' | 'slideshow';
  shuffle: boolean;
  actionsSlot: HTMLElement | null;
  onChanged: (ds: Dataset) => void;
}) {
  // Inline editing: `editing` holds a working copy of the item being edited; `picker`
  // toggles the image swapper for it; `saving` disables the form during the write.
  const [editing, setEditing] = useState<Item | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  // Only one card's details are ever open at a time — expanding one collapses whatever
  // else was open, so the wall of images doesn't fill up with expanded panels.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The clicked tile's own on-screen box, captured the instant a mosaic tile opens —
  // ItemModal grows out of it and shrinks back into it on close (lib/genie.ts), the
  // same genie effect the embed's mosaic opens a picture with.
  const [openOrigin, setOpenOrigin] = useState<DOMRect | null>(null);
  // The open item is part of what Claude is told you're looking at — "this" in a
  // message then means it (lib/chatView.tsx).
  const openForChat = expandedId ? ds.items.find((i) => i.id === expandedId) : undefined;
  useReportChatView({ itemId: openForChat?.id, itemName: openForChat?.name });
  // How much wider than the page column the grid is, driven by pinch / ctrl+scroll
  // over the grid (there is no on-screen control). Starts at DEFAULT_ZOOM every mount (see the comment
  // on it above) — a refresh, or coming back from another dataset, always lands on the
  // three-wide default.
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM);
  const setZoom = (next: number | ((z: number) => number)) =>
    setZoomState((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, typeof next === 'function' ? next(z) : next)));
  // The sideways-scrolling frame the grid sits in, and the width to ask the image host
  // for: rounded up to a tenth of the window so a zoom drag doesn't refetch every tile.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const tileSizes = `${Math.ceil(zoom) * 10}vw`;
  // The scroller's width, tracked only so the tweet tiles know how big a cell is:
  // cell = (zoom × width − gaps) / COLS, and a tile is drawn TILE_W wide then scaled to it.
  const [frameW, setFrameW] = useState(0);
  const hasWall = pool.length > 0 && view === 'mosaic';
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el);
    setFrameW(el.clientWidth);
    return () => ro.disconnect();
  }, [hasWall]);
  const tileScale = frameW ? (zoom * frameW - (COLS - 1) * 4) / COLS / TILE_W : 1;

  // Zoom keeps whichever card you're focused on in place, rather than the reflow
  // yanking the whole page back to the top-left corner — a wall of a hundred cards is
  // otherwise unnavigable at speed, since every zoom step loses your place. `itemNodesRef`
  // is every rendered card's own DOM node, keyed by item id, kept live by the ref
  // callback below; `hoveredIdRef` is whichever one the pointer is over right now, kept
  // live by the onMouseEnter on each card wrapper. `anchorRef` is the card + its
  // on-screen position captured the instant BEFORE a zoom change is applied, so the
  // layout effect below can measure where that same card landed AFTER the reflow and
  // scroll by the difference — same trick a map or PDF viewer uses to zoom "into" a point.
  const itemNodesRef = useRef(new Map<string, HTMLElement>());
  const hoveredIdRef = useRef<string | null>(null);
  const anchorRef = useRef<{ id: string; top: number; left: number } | null>(null);

  // Tracks whether ItemModal (the full-screen detail view) is currently showing, so
  // the grid's own pinch/ctrl+scroll zoom below can step aside — see its use in
  // onWheel. A ref, not state, since it only needs to be read inside that native
  // listener, not to drive a render.
  const modalOpen = !!expandedId && !editing;
  const modalOpenRef = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    modalOpenRef.current = modalOpen;
  }, [modalOpen]);

  // `point`, when given (the wheel/pinch case), pins the anchor to whatever card is
  // literally under the pointer at that instant — more precise than the last
  // mouseenter, since a fast pinch can arrive before the enter event does. Without a
  // point (a zoom-control button or the slider, where the pointer is over the control,
  // not a card), it falls back to `hoveredIdRef` — the last card the mouse was over.
  function captureZoomAnchor(point?: { x: number; y: number }) {
    let id = hoveredIdRef.current;
    if (point) {
      const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-item-id]');
      if (hit?.dataset.itemId) id = hit.dataset.itemId;
    }
    const el = id ? itemNodesRef.current.get(id) : undefined;
    const rect = el?.getBoundingClientRect();
    anchorRef.current = rect ? { id: id as string, top: rect.top, left: rect.left } : null;
  }

  // Runs after the reflow but before the browser paints it, so the correction itself
  // is never visible — only the zoom is.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const el = itemNodesRef.current.get(anchor.id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (scrollerRef.current) scrollerRef.current.scrollLeft += rect.left - anchor.left;
    const dy = rect.top - anchor.top;
    if (dy) window.scrollBy(0, dy);
  }, [zoom]);

  // Pinch-to-zoom, trackpad or mouse: both a trackpad pinch gesture and a ctrl/⌘+scroll
  // on a mouse wheel arrive in the browser as the same thing — a `wheel` event with
  // `ctrlKey` set (there's no separate pinch event on the web platform). Listened for
  // on the whole page, not just the grid, so it works the moment the cursor is
  // anywhere over the card wall, not just exactly between two cards. A plain,
  // unmodified scroll is left alone — that's still just scrolling the page.
  // Native addEventListener with `{ passive: false }`, not React's onWheel: the browser
  // treats wheel listeners as passive by default, which silently drops preventDefault
  // and lets the page itself zoom instead.
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      // ItemModal owns pinch/ctrl+scroll while it's open — it stops the event from
      // reaching here (see its own onWheel) so the grid underneath never reflows
      // while you're zooming the focused card. This is only a fallback in case some
      // future modal chrome doesn't stop propagation.
      if (modalOpenRef.current || viewRef.current !== 'mosaic') return;
      e.preventDefault();
      // Anchor to whatever card is under the pointer right now — captured once per
      // event, before any of the steps below, so it reflects the card's position
      // before this event's reflow rather than a stale one from a previous step.
      captureZoomAnchor({ x: e.clientX, y: e.clientY });
      // Pinching/scrolling "out" (deltaY > 0, same direction as zooming a page out)
      // shrinks the cards; the reverse zooms in. Multiplicative, so every notch feels
      // the same whether the wall is small or big; a mouse wheel's ±100 notch is capped
      // so it isn't a lurch.
      const d = Math.max(-30, Math.min(30, e.deltaY));
      setZoom((z) => z * Math.exp(-d * 0.01));
    }
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  // The personal world is built by hand (9-personal-and-auth.md), so its browse view
  // doubles as the builder: add one item, drop in a batch of files, delete, and edit
  // the dataset's own shape. None of it shows in the researched worlds.
  const personal = ds.domain === 'personal';
  const [editingField, setEditingField] = useState(false);
  // Offered where it makes sense: a dataset that already holds Instagram posts, or an
  // empty one waiting for its first batch (components/InstagramImportPanel.tsx).
  const [importing, setImporting] = useState(false);
  const takesInstagram = personal && (ds.items.length === 0 || ds.items.some((i) => i.instagram));
  // A draft from "+ Add item" isn't in the dataset until it's saved — so it isn't in
  // `pool` either, and is drawn ahead of the grid instead (see `isNew` below).
  const isNew = !!editing && !ds.items.some((i) => i.id === editing.id);

  function blankItem(change: Partial<Item> = {}): Item {
    return {
      // Minted here rather than left to the server (which would, routes/datasets.ts):
      // the editor finds its item by id, and a draft needs one before its first save.
      id: crypto.randomUUID(),
      name: '',
      description: '',
      image: '',
      year: null,
      brand: '',
      creator: '',
      definingFact: '',
      subtopic: '',
      createdAt: new Date().toISOString(),
      ...change,
    };
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await saveDataset(ds.id, {
        items: isNew
          ? [...ds.items, editing]
          : ds.items.map((i) => (i.id === editing.id ? editing : i)),
      });
      onChanged(updated);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEditing() {
    if (!editing) return;
    setSaving(true);
    try {
      // The server removes the item's uploaded file along with it (routes/datasets.ts).
      const updated = await saveDataset(ds.id, {
        items: ds.items.filter((i) => i.id !== editing.id),
      });
      onChanged(updated);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {personal &&
        actionsSlot &&
        createPortal(
          <>
            <button onClick={() => setEditingField((v) => !v)} className="inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
              Edit
            </button>
            <button onClick={() => setEditing(blankItem())} disabled={!!editing} className="inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-40">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add
            </button>
            {takesInstagram && (
              <button onClick={() => setImporting((v) => !v)} className="inline-flex items-center gap-1 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
                  <path d="M12 3v12M6 9l6 6 6-6" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                Import
              </button>
            )}
          </>,
          actionsSlot,
        )}
      {takesInstagram && importing && (
        <InstagramImportPanel ds={ds} onChanged={onChanged} onClose={() => setImporting(false)} />
      )}
      {personal && editingField && (
        <PersonalFieldEditor ds={ds} onChanged={onChanged} onClose={() => setEditingField(false)} />
      )}

      {pool.length === 0 && !isNew ? (
        <p className="text-[var(--color-muted)]">
          {personal && ds.items.length === 0
            ? 'Nothing here yet — add an item to start the collection.'
            : 'No items in this scope.'}
        </p>
      ) : view === 'slideshow' ? (
        <>
          {isNew && editing && (
            <div className="mx-auto max-w-xl">
              <ItemEditorCard
                key={editing.id}
                draft={editing}
                subtopics={ds.subtopics}
                domain={ds.domain}
                saving={saving}
                onChange={(c) => setEditing((e) => (e ? { ...e, ...c } : e))}
                onSwapImage={() => setPicker(true)}
                onSave={saveEdit}
                onCancel={() => setEditing(null)}
              />
            </div>
          )}
          <Slideshow ds={ds} pool={pool} shuffle={shuffle} onChanged={onChanged} />
        </>
      ) : (
        <div ref={scrollerRef} className="overflow-x-auto overflow-y-hidden">
        {/* overflow-x alone would make overflow-y `auto` too, and a stacked tweet hand's
            fanned corners hang a few px below the last row — enough for a needless
            vertical scrollbar. Clip that axis, and pad the grid so the fan isn't cut. */}
        <div
          className="grid gap-1 pb-3"
          style={
            {
              width: `${zoom * 100}%`,
              gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))`,
              '--tile-scale': tileScale,
            } as CSSProperties
          }
        >
          {isNew && editing && (
            <ItemEditorCard
              key={editing.id}
              draft={editing}
              subtopics={ds.subtopics}
              domain={ds.domain}
              saving={saving}
              onChange={(c) => setEditing((e) => (e ? { ...e, ...c } : e))}
              onSwapImage={() => setPicker(true)}
              onSave={saveEdit}
              onCancel={() => setEditing(null)}
            />
          )}
          {pool.map((item) =>
            editing?.id === item.id ? (
              <ItemEditorCard
                key={item.id}
                draft={editing}
                subtopics={ds.subtopics}
                domain={ds.domain}
                saving={saving}
                onChange={(c) => setEditing((e) => (e ? { ...e, ...c } : e))}
                onSwapImage={() => setPicker(true)}
                onSave={saveEdit}
                onCancel={() => setEditing(null)}
                onDelete={personal ? deleteEditing : undefined}
              />
            ) : (
              <div
                key={item.id}
                data-item-id={item.id}
                ref={(el) => {
                  if (el) itemNodesRef.current.set(item.id, el);
                  else itemNodesRef.current.delete(item.id);
                }}
                onMouseEnter={() => {
                  hoveredIdRef.current = item.id;
                }}
                onMouseLeave={() => {
                  if (hoveredIdRef.current === item.id) hoveredIdRef.current = null;
                }}
                className="relative"
              >
                {item.tweet ? (
                  /* Opens the same full-screen, genie-animated view as a picture does
                     (TweetModal below) — grown out of this tile. */
                  <TweetCard
                    item={item}
                    onOpen={(rect) => {
                      setOpenOrigin(rect);
                      setExpandedId(item.id);
                    }}
                  />
                ) : item.instagram ? (
                  <InstagramCard
                    item={item}
                    onOpen={(rect) => {
                      setOpenOrigin(rect);
                      setExpandedId(item.id);
                    }}
                  />
                ) : (
                /* The card itself opens the full-screen modal below — works on touch,
                   not just hover. */
                <ItemCard
                  item={item}
                  onOpen={(rect) => {
                    setOpenOrigin(rect);
                    setExpandedId(item.id);
                  }}
                  sizes={tileSizes}
                />
                )}
              </div>
            ),
          )}
        </div>
        </div>
      )}

      {expandedId &&
        !editing &&
        (() => {
          const openItem = pool.find((i) => i.id === expandedId);
          if (!openItem) return null;
          const close = () => {
            setExpandedId(null);
            setOpenOrigin(null);
          };
          return openItem.tweet || openItem.instagram ? (
            <TweetModal
              item={openItem}
              originRect={openOrigin ?? undefined}
              onClose={close}
              onEdit={() => {
                setEditing({ ...openItem });
                close();
              }}
            />
          ) : (
            <ItemModal
              ds={ds}
              item={openItem}
              originRect={openOrigin ?? undefined}
              onClose={close}
              onChanged={onChanged}
            />
          );
        })()}

      {picker && editing && (
        <ImagePicker
          target={
            ds.domain === 'digital'
              ? {
                  kind: 'screenshot',
                  url: editing.url ?? '',
                  year: editing.year,
                  name: editing.name,
                  imageKind: editing.imageKind,
                  wikipediaTitle: editing.wikipediaTitle,
                  imageQuery: editing.imageQuery,
                }
              : { kind: 'search', query: physicalImageQuery(editing) }
          }
          allowUpload={personal}
          onPick={(url) => {
            // Hand-picked, so the recorded capture no longer describes this image.
            setEditing((e) => (e ? { ...e, image: url, capture: undefined } : e));
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

// Inline editor for a saved item — the same minimalist form as everywhere else,
// outlined in the accent colour so it reads as "editing". Save writes through to disk.
function ItemEditorCard({
  draft,
  subtopics,
  domain,
  saving,
  onChange,
  onSwapImage,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Item;
  subtopics: Subtopic[];
  domain: Domain;
  saving: boolean;
  onChange: (change: Partial<Item>) => void;
  onSwapImage: () => void;
  onSave: () => void;
  onCancel: () => void;
  /** Personal world only, and only for an item that's already saved. */
  onDelete?: () => void;
}) {
  return (
    <div className="space-y-2 border border-[var(--color-accent)] bg-[var(--color-card)] p-3">
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-wall-soft)]">
        <Photo src={draft.image} alt={draft.name} />
        <button
          onClick={onSwapImage}
          className="absolute bottom-2 right-2 rounded-full bg-[var(--color-ink)]/80 px-3 py-1 text-xs text-[var(--color-wall)]"
        >
          Swap image
        </button>
      </div>
      <ItemFields item={draft} subtopics={subtopics} domain={domain} onChange={onChange} />
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-xs disabled:opacity-40"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="ml-auto text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
