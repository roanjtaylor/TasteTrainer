import { useEffect, useState, type WheelEvent } from 'react';
import type { Dataset, Item } from '../../../shared/types';
import { saveDataset } from '../lib/data';
import { physicalImageQuery } from '../lib/image';
import { useChatView } from '../lib/chatView';
import { CaptureBadge } from './CaptureBadge';
import { PenIcon } from './ItemCard';
import { ItemFields } from './ItemFields';
import { ImagePicker } from './ImagePicker';
import { Photo } from './Photo';

// The full-screen view a card click opens: the image at real size on the left, every
// field on the right — replaced the old behaviour of appending the same fields below
// the card in the grid, which grew that one card and broke up the mosaic exactly
// where you'd clicked to look closer.
//
// Editing lives here too now, as a second mode of the SAME dialog rather than a
// separate inline card + a separate image-picker dialog reached by first closing this
// one: "Edit" swaps the right-hand pane for the form (ItemFields — the same one every
// other edit surface in the app already uses) in place, and "Swap image" opens the
// picker on top without ever leaving the modal. Saving or cancelling lands you back
// on the same item's view pane, not out in the grid somewhere.
export function ItemModal({
  ds,
  item,
  onClose,
  onChanged,
}: {
  ds: Dataset;
  item: Item;
  onClose: () => void;
  onChanged: (ds: Dataset) => void;
}) {
  const personal = ds.domain === 'personal';
  const { ask } = useChatView();
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState<Item | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pinch/ctrl+scroll zooms the focused card itself — image and text together — rather
  // than the dataset wall behind it. Resets whenever a different item opens, so zoom
  // never carries over from whatever was last inspected.
  const [scale, setScale] = useState(1);
  const MIN_SCALE = 1;
  const MAX_SCALE = 3;
  useEffect(() => {
    setScale(1);
  }, [item.id]);
  function onWheel(e: WheelEvent<HTMLDivElement>) {
    if (!e.ctrlKey && !e.metaKey) return;
    // Consumed here so it never reaches the grid's own wheel listener underneath —
    // the dataset wall must not reflow while the modal is what's being zoomed.
    e.preventDefault();
    e.stopPropagation();
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - e.deltaY * 0.01)));
  }

  function startEdit() {
    setDraft({ ...item });
    setMode('edit');
  }
  function startSwap() {
    setDraft((d) => d ?? { ...item });
    setMode('edit');
    setPicker(true);
  }
  function cancelEdit() {
    setDraft(null);
    setPicker(false);
    setMode('view');
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const updated = await saveDataset(ds.id, {
        items: ds.items.map((i) => (i.id === draft.id ? draft : i)),
      });
      onChanged(updated);
      setDraft(null);
      setPicker(false);
      setMode('view');
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    setSaving(true);
    try {
      // The server removes the item's uploaded file along with it (routes/datasets.ts).
      const updated = await saveDataset(ds.id, { items: ds.items.filter((i) => i.id !== item.id) });
      onChanged(updated);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Escape steps back one layer at a time — close the picker, then drop back to the
  // view pane, then finally the whole modal — rather than a single Escape anywhere
  // discarding an in-progress edit straight back out to the grid.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || saving) return;
      if (picker) setPicker(false);
      else if (mode === 'edit') cancelEdit();
      else onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, mode, saving]);

  const editing = mode === 'edit' && draft;
  const shownImage = editing ? draft.image : item.image;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      // A stray click on the backdrop mid-edit only backs out of editing, not the
      // whole modal — the same graduated retreat as Escape, so it can't silently
      // discard a half-finished edit as a side effect of missing the panel. Ignored
      // entirely while a save/delete is in flight, so it can't be dismissed out from
      // under its own request.
      onClick={() => {
        if (saving) return;
        if (mode === 'edit') cancelEdit();
        else onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name || 'Item details'}
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        style={{ transform: scale !== 1 ? `scale(${scale})` : undefined }}
        className="grid h-full max-h-[42rem] w-full max-w-5xl grid-cols-1 overflow-hidden border border-[var(--color-line)] bg-[var(--color-card)] md:grid-cols-2"
      >
        <div className="relative aspect-[4/3] w-full bg-[var(--color-wall-soft)] md:aspect-auto md:h-full">
          <Photo src={shownImage} alt={item.name} sizes="(min-width: 768px) 50vw, 100vw" />
          {!editing && <CaptureBadge capture={item.capture} year={item.year} />}
          {editing && (
            <button
              onClick={startSwap}
              disabled={saving}
              className="absolute right-3 top-3 rounded-full bg-[var(--color-ink)]/80 px-3 py-1.5 text-xs text-[var(--color-wall)] disabled:opacity-40"
            >
              Swap image
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-col overflow-y-auto p-5">
          {editing ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <h2 className="serif text-2xl leading-tight">Edit</h2>
                {/* Save/Cancel take over the same top-right slot the Edit button and ✕
                    sit in on the view pane — one place to look for "what does this
                    button do" whichever pane you're on, rather than a ✕ up here that
                    silently discards the draft and the real actions stuck at the
                    bottom. */}
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={save}
                    disabled={saving}
                    className="rounded-full bg-[var(--color-accent)] px-5 py-1.5 text-sm text-white disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    disabled={saving}
                    className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <ItemFields
                  item={draft}
                  subtopics={ds.subtopics}
                  domain={ds.domain}
                  onChange={(c) => setDraft((d) => (d ? { ...d, ...c } : d))}
                />
              </div>
              {/* Deleting is only ever meaningful for the hand-built personal world —
                  a researched item isn't yours to remove, just to hide via a filter. */}
              {personal && (
                <div className="mt-auto pt-5">
                  <button
                    onClick={del}
                    disabled={saving}
                    className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
                  >
                    Delete
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="serif truncate text-2xl leading-tight">{item.name || 'Untitled'}</h2>
                  <p className="text-sm text-[var(--color-muted)]">
                    {[item.year ?? undefined, item.brand, item.creator].filter(Boolean).join(' · ') ||
                      '—'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Opens the Claude dock with this item as its context (the grid reports
                      the open item — lib/chatView.tsx). The dock floats above this modal. */}
                  <button
                    onClick={() => ask()}
                    title="Ask Claude about this"
                    className="rounded-full border border-[var(--color-claude)]/60 px-3 py-1 text-xs text-[var(--color-claude)] hover:bg-[var(--color-wall-soft)]"
                  >
                    Ask Claude
                  </button>
                  <button
                    onClick={startEdit}
                    aria-label="Edit"
                    title="Edit"
                    className="rounded-full border border-[var(--color-line)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
                  >
                    <PenIcon />
                  </button>
                  <button
                    onClick={onClose}
                    aria-label="Close"
                    title="Close"
                    className="rounded-full border border-[var(--color-line)] p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
                  >
                    <CloseIcon />
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {item.description && <p className="text-sm leading-relaxed">{item.description}</p>}
                {item.definingFact && (
                  <p className="text-sm italic text-[var(--color-muted)]">{item.definingFact}</p>
                )}
                {item.subtopic && (
                  <p className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
                    {item.subtopic}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {picker && draft && (
        <ImagePicker
          target={
            ds.domain === 'digital'
              ? {
                  kind: 'screenshot',
                  url: draft.url ?? '',
                  year: draft.year,
                  name: draft.name,
                  imageKind: draft.imageKind,
                  wikipediaTitle: draft.wikipediaTitle,
                  imageQuery: draft.imageQuery,
                }
              : { kind: 'search', query: physicalImageQuery(draft) }
          }
          allowUpload={personal}
          onPick={(url) => {
            // Hand-picked, so the recorded capture no longer describes this image.
            setDraft((d) => (d ? { ...d, image: url, capture: undefined } : d));
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}
    </div>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
      <path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}
