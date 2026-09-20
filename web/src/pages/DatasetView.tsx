import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Dataset, Domain, Item, ItemReport, Subtopic } from '../../../shared/types';
import { saveDataset, useDataset } from '../lib/data';
import { api } from '../lib/api';
import { useChatView, useReportChatView } from '../lib/chatView';
import { physicalImageQuery } from '../lib/image';
import { ItemCard } from '../components/ItemCard';
import { ItemModal } from '../components/ItemModal';
import { TweetCard } from '../components/TweetCard';
import { TweetImportPanel } from '../components/TweetImportPanel';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';
import { BackToTop } from '../components/BackToTop';
import { PersonalFieldEditor } from '../components/PersonalFieldEditor';
import { NavActions } from '../lib/navActions';

// ---- Grid zoom ----
// How many cards sit across the row: 1 (one card filling the width) to 10 (a tight
// mosaic). Deliberately NOT persisted — every fresh load (including a plain refresh)
// starts back at DEFAULT_COLS, so the desktop default is always the three-wide view
// rather than whatever size a previous session happened to leave it zoomed to.
const MIN_COLS = 1;
const MAX_COLS = 10;
const DEFAULT_COLS = 3;

// The Dataset view (6-ui.md): the whole field as one wall, oldest first.
export function DatasetView() {
  // /physical/ships — the world and the field, both readable in the address bar.
  const { domain = '', slug = '' } = useParams();
  // Cached read: a dataset seen before paints immediately and corrects itself in the
  // background, so returning to it costs nothing (lib/store.ts).
  const { data: ds, error: loadError, set: setDs } = useDataset(slug || null);
  // Tell the Claude dock what's on screen (lib/chatView.tsx).
  useReportChatView({ datasetId: ds?.id, datasetTopic: ds?.topic });

  // Chronological (undated last): the one ordering that needs no labels to read.
  const pool = useMemo(
    () => (ds ? [...ds.items].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity)) : []),
    [ds],
  );

  if (loadError) return <p className="mt-8 text-[var(--color-accent)]">{loadError}</p>;
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* This field's name, description and item count, pinned to the top-left for
          the whole scroll: on a long wall of images it's the one thing worth never
          losing. It's left-aligned in the margin beside the centred content column, so
          it sits alongside the grid rather than over it. Below md there's no margin to
          sit in, so it scrolls with the page like an ordinary heading. */}
      <div className="group relative md:fixed md:left-4 md:top-3 md:z-30 md:w-48 lg:w-60 xl:w-72">
        <h1 className="serif truncate text-xl leading-tight" title={ds.description || undefined}>
          {ds.topic}
        </h1>
        {ds.description && (
          <div
            role="tooltip"
            className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1 w-64 rounded-md bg-black px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
          >
            {ds.description}
          </div>
        )}
        <p className="truncate text-xs text-[var(--color-muted)]">
          {ds.items.length} {ds.items.length === 1 ? 'item' : 'items'}
        </p>
      </div>

      <ReportsPanel datasetId={ds.id} />

      <Browse
        ds={ds}
        pool={pool}
        onChanged={setDs}
      />

      <BackToTop />
    </div>
  );
}

// ---- Reports: what visitors flagged from the public embed widget's card-back
// (Embed.tsx's flip), read through server/src/routes/reports.ts. Shown only while
// there's something open to look at — most datasets most of the time have nothing
// here, and an empty "0 reports" strip would just be permanent clutter. ----
function ReportsPanel({ datasetId }: { datasetId: string }) {
  const [reports, setReports] = useState<ItemReport[] | null>(null);
  const { ask } = useChatView();

  useEffect(() => {
    let cancelled = false;
    api
      .listReports(datasetId)
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
      await api.dismissReport(id);
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
              <button
                onClick={() =>
                  ask(
                    `A visitor flagged a problem with "${r.itemName}" via the embed widget: "${r.text}". Please look into it and fix the dataset if something needs fixing.`,
                  )
                }
                title="Ask Claude about this"
                className="rounded-full border border-[var(--color-claude)]/60 px-3 py-1 text-xs text-[var(--color-claude)] hover:bg-[var(--color-wall-soft)]"
              >
                Ask Claude
              </button>
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
  onChanged,
}: {
  ds: Dataset;
  pool: Item[];
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
  // The open item is part of what Claude is told you're looking at — "this" in a
  // message then means it (lib/chatView.tsx).
  const openForChat = expandedId ? ds.items.find((i) => i.id === expandedId) : undefined;
  useReportChatView({ itemId: openForChat?.id, itemName: openForChat?.name });
  // General "click anything else closes it" rule: a mousedown outside the expanded
  // card's own DOM (tracked via this ref) collapses it, whatever that click turns out
  // to do — open the editor, open "+ Add item", swap the image, and so on. mousedown
  // (not click) so this runs before the target's own click handler, letting a click on
  // a *different* image collapse this one and expand that one in the same gesture
  // rather than closing then failing to reopen.
  const expandedRef = useRef<HTMLDivElement | null>(null);
  // Cards-per-row, driven by the zoom control fixed in the window's right margin below
  // — replaces the old fixed 1/2/3-column breakpoints with one continuous dial. Starts
  // at DEFAULT_COLS every mount (see the comment on it above) — a refresh, or coming
  // back from another dataset, always lands on the three-wide default.
  const [cols, setCols] = useState(DEFAULT_COLS);
  const setZoom = (next: number | ((c: number) => number)) =>
    setCols((c) => Math.max(MIN_COLS, Math.min(MAX_COLS, typeof next === 'function' ? next(c) : next)));

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
  const anchorRef = useRef<{ id: string; top: number } | null>(null);

  // Tracks whether ItemModal (the full-screen detail view) is currently showing, so
  // the grid's own pinch/ctrl+scroll zoom below can step aside — see its use in
  // onWheel. A ref, not state, since it only needs to be read inside that native
  // listener, not to drive a render.
  const modalOpen = !!expandedId && !editing && !!pool.find((i) => i.id === expandedId && !i.tweet);
  const modalOpenRef = useRef(false);
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
    anchorRef.current = el ? { id: id as string, top: el.getBoundingClientRect().top } : null;
  }

  function zoomBy(next: number | ((c: number) => number)) {
    captureZoomAnchor();
    setZoom(next);
  }

  // Runs after the reflow but before the browser paints it, so the correction itself
  // is never visible — only the zoom is.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const el = itemNodesRef.current.get(anchor.id);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - anchor.top;
    if (delta) window.scrollBy(0, delta);
  }, [cols]);

  // Pinch-to-zoom, trackpad or mouse: both a trackpad pinch gesture and a ctrl/⌘+scroll
  // on a mouse wheel arrive in the browser as the same thing — a `wheel` event with
  // `ctrlKey` set (there's no separate pinch event on the web platform). Listened for
  // on the whole page, not just the grid, so it works the moment the cursor is
  // anywhere over the card wall, not just exactly between two cards. A plain,
  // unmodified scroll is left alone — that's still just scrolling the page.
  // Native addEventListener with `{ passive: false }`, not React's onWheel: the browser
  // treats wheel listeners as passive by default, which silently drops preventDefault
  // and lets the page itself zoom instead.
  const wheelAccumRef = useRef(0);
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      // ItemModal owns pinch/ctrl+scroll while it's open — it stops the event from
      // reaching here (see its own onWheel) so the grid underneath never reflows
      // while you're zooming the focused card. This is only a fallback in case some
      // future modal chrome doesn't stop propagation.
      if (modalOpenRef.current) return;
      e.preventDefault();
      // Anchor to whatever card is under the pointer right now — captured once per
      // event, before any of the steps below, so it reflects the card's position
      // before this event's reflow rather than a stale one from a previous step.
      captureZoomAnchor({ x: e.clientX, y: e.clientY });
      // A pinch fires a flurry of tiny deltas; accumulating and stepping in whole
      // columns keeps the grid from jittering between sizes on every event.
      wheelAccumRef.current += e.deltaY;
      const STEP = 12;
      // Pinching/scrolling "out" (deltaY > 0, same direction as zooming a page out)
      // shrinks the cards — more, smaller columns; the reverse zooms in.
      while (wheelAccumRef.current >= STEP) {
        wheelAccumRef.current -= STEP;
        setZoom((c) => c + 1);
      }
      while (wheelAccumRef.current <= -STEP) {
        wheelAccumRef.current += STEP;
        setZoom((c) => c - 1);
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  // Tweets still expand in place (TweetCard), so a click outside the open thread
  // collapses it. A non-tweet item instead opens ItemModal below, which owns its own
  // closing (backdrop click, Escape, ✕) — this guard would otherwise fight it: the
  // modal's own buttons live outside `expandedRef` (the grid cell, not the modal), so
  // this listener would collapse `expandedId` out from under a click on them before
  // their own onClick ever ran.
  useEffect(() => {
    if (!expandedId) return;
    const openItem = pool.find((i) => i.id === expandedId);
    if (!openItem?.tweet) return;
    function onOutsideDown(e: MouseEvent) {
      // The Claude dock is "outside" too, but clicking into it to ask about the open
      // thread must not close the thread — that is the context being asked about.
      if ((e.target as Element | null)?.closest?.('[data-chat-dock]')) return;
      if (expandedRef.current && !expandedRef.current.contains(e.target as Node)) {
        setExpandedId(null);
      }
    }
    document.addEventListener('mousedown', onOutsideDown);
    return () => document.removeEventListener('mousedown', onOutsideDown);
  }, [expandedId, pool]);

  // The personal world is built by hand (9-personal-and-auth.md), so its browse view
  // doubles as the builder: add one item, drop in a batch of files, delete, and edit
  // the dataset's own shape. None of it shows in the researched worlds.
  const personal = ds.domain === 'personal';
  const [editingField, setEditingField] = useState(false);
  // Offered where it makes sense: a dataset that already holds tweets, or an empty one
  // that could become one — not on a shelf of book covers.
  const [importingTweets, setImportingTweets] = useState(false);
  const takesTweets = personal && (ds.items.length === 0 || ds.items.some((i) => i.tweet));
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
      {personal && (
        <NavActions>
          <button
            onClick={() => setEditingField((v) => !v)}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            Edit dataset
          </button>
          {takesTweets && (
            <button
              onClick={() => setImportingTweets((v) => !v)}
              className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
            >
              Import tweets
            </button>
          )}
          <button
            onClick={() => setEditing(blankItem())}
            disabled={!!editing}
            aria-label="Add item"
            title="Add item"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ink)] text-lg leading-none text-[var(--color-wall)] disabled:opacity-40"
          >
            +
          </button>
        </NavActions>
      )}
      {personal && editingField && (
        <PersonalFieldEditor ds={ds} onChanged={onChanged} onClose={() => setEditingField(false)} />
      )}
      {takesTweets && importingTweets && (
        <TweetImportPanel ds={ds} onChanged={onChanged} onClose={() => setImportingTweets(false)} />
      )}

      {pool.length === 0 && !isNew ? (
        <p className="text-[var(--color-muted)]">
          {personal && ds.items.length === 0
            ? 'Nothing here yet — add an item to start the collection.'
            : 'No items in this scope.'}
        </p>
      ) : (
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
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
                  if (expandedId === item.id) expandedRef.current = el;
                }}
                onMouseEnter={() => {
                  hoveredIdRef.current = item.id;
                }}
                onMouseLeave={() => {
                  if (hoveredIdRef.current === item.id) hoveredIdRef.current = null;
                }}
                className="relative"
                // An open thread is for reading, and a tenth of the row isn't a readable
                // measure — so it takes about a third of the width whatever the zoom.
                style={
                  item.tweet && expandedId === item.id
                    ? { gridColumn: `span ${Math.max(1, Math.ceil(cols / 3))}` }
                    : undefined
                }
              >
                {item.tweet ? (
                  <TweetCard
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                    onEdit={() => setEditing({ ...item })}
                  />
                ) : (
                /* The card itself opens the full-screen modal below — works on touch,
                   not just hover. */
                <ItemCard item={item} onOpen={() => setExpandedId(item.id)} />
                )}
              </div>
            ),
          )}
        </div>
      )}

      {expandedId &&
        !editing &&
        (() => {
          const openItem = pool.find((i) => i.id === expandedId);
          if (!openItem || openItem.tweet) return null;
          return (
            <ItemModal
              ds={ds}
              item={openItem}
              onClose={() => setExpandedId(null)}
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

      {pool.length > 0 && <ZoomControl cols={cols} onChange={zoomBy} />}
    </div>
  );
}

// A vertical slider fixed in the window's right margin — the same home the account
// button already keeps there (main.tsx) — so scrolling a long wall of
// cards always leaves one dial in reach for how much of it is on screen at once.
// Dragging up = fewer, bigger cards (zoomed in, down to one filling the row); dragging
// down = more, smaller ones (zoomed out, up to a ten-wide mosaic). Continuous, so it
// replaces the old fixed sm/lg breakpoints with a real dial rather than three stops.
function ZoomControl({
  cols,
  onChange,
}: {
  cols: number;
  /** Clamps to [MIN_COLS, MAX_COLS] itself — callers can freely pass cols ± 1. */
  onChange: (next: number | ((c: number) => number)) => void;
}) {
  // The <input> itself always runs low-to-high bottom-to-top; the zoom LEVEL (big cards
  // = high zoom) is the inverse of the column count, so the thumb sits high when cards
  // are big and low when they're tiny, matching how a zoom slider reads everywhere else.
  const zoomLevel = MAX_COLS + MIN_COLS - cols;
  return (
    <div
      className="fixed bottom-6 right-3 z-30 flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-3 text-[var(--color-muted)] shadow-sm backdrop-blur"
      title={`${cols} across — drag, click ±, or pinch/ctrl+scroll over the grid`}
    >
      {/* Fewer, bigger cards. Disabled at one-across rather than hidden, so the
          button's position — and the dial below it — never jumps around. */}
      <button
        type="button"
        onClick={() => onChange((c) => c - 1)}
        disabled={cols <= MIN_COLS}
        aria-label="Zoom in (fewer, bigger cards)"
        className="select-none text-sm leading-none hover:text-[var(--color-ink)] disabled:opacity-30"
      >
        ＋
      </button>
      <input
        type="range"
        min={MIN_COLS}
        max={MAX_COLS}
        step={1}
        value={zoomLevel}
        onChange={(e) => onChange(MAX_COLS + MIN_COLS - Number(e.target.value))}
        aria-label="Zoom: cards per row"
        className="h-32 w-5 cursor-pointer accent-[var(--color-accent)]"
        style={{
          WebkitAppearance: 'slider-vertical',
          writingMode: 'vertical-lr',
          direction: 'rtl',
        } as React.CSSProperties}
        // Firefox's own vertical-range mechanism (ignores writing-mode on range inputs).
        // Not a real DOM attribute React knows about, so it's passed through untyped.
        {...{ orient: 'vertical' }}
      />
      {/* More, smaller cards. */}
      <button
        type="button"
        onClick={() => onChange((c) => c + 1)}
        disabled={cols >= MAX_COLS}
        aria-label="Zoom out (more, smaller cards)"
        className="select-none text-sm leading-none hover:text-[var(--color-ink)] disabled:opacity-30"
      >
        －
      </button>
      <span className="mt-0.5 select-none text-[10px] tabular-nums">{cols}×</span>
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
