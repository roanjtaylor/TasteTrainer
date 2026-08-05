import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EVERYONE, slugifyTopic } from '../../../shared/types';
import type {
  CoverageGap,
  Dataset,
  Domain,
  EraGroup,
  Item,
  LeaderboardRow,
  ProposedItem,
  RankerSummary,
  Subtopic,
} from '../../../shared/types';
import { api, type Progress, type ScopeQuery } from '../lib/api';
import {
  deleteDataset,
  saveDataset,
  useDataset,
  useLeaderboard,
  useRankers,
  vote as castVote,
} from '../lib/data';
import { useRanker } from '../lib/ranker';
import { eraOf, eraGroupsOf, decadesInRange, itemsInGroup } from '../lib/format';
import { ItemCard, Chip } from '../components/ItemCard';
import { ImagePicker } from '../components/ImagePicker';
import { NameEntry, RankerBadge } from '../components/NameEntry';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';
import { ReviewCard } from './Curate';

// 'edit' shows the same grid as 'browse' plus the destructive affordances (remove).
// It is reached from the mode switcher in the header.
type Mode = 'browse' | 'edit' | 'rank' | 'leaderboard';

// The single active filter — one axis at a time (a subtopic OR an era-group), or none.
// Derived from the URL so it's shareable and back-button friendly.
type ActiveFilter =
  | { kind: 'subtopic'; name: string }
  | { kind: 'era'; group: EraGroup }
  | null;

// The Dataset view (6-ui.md): browse the items, pick a scope, run the 1v1
// forced choice, and see the leaderboard — all one screen.
export function DatasetView() {
  // /physical/ships — the world and the field, both readable in the address bar.
  const { domain = '', slug = '' } = useParams();
  // Cached read: a dataset seen before paints immediately and corrects itself in the
  // background, so returning to it costs nothing (lib/store.ts).
  const { data: ds, error: loadError, set: setDs } = useDataset(slug || null);
  const [mode, setMode] = useState<Mode>('browse');

  const [editingMeta, setEditingMeta] = useState(false);
  const [gaps, setGaps] = useState<CoverageGap[] | null>(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [gapProgress, setGapProgress] = useState('');
  const [gapSuggestedCount, setGapSuggestedCount] = useState(8);
  const [gapError, setGapError] = useState('');

  const [refetching, setRefetching] = useState(false);
  const [refetchProgress, setRefetchProgress] = useState('');
  const [refetchNote, setRefetchNote] = useState('');

  // The single active filter lives in the URL (?sub=… or ?era=start-end), so it's
  // shareable and the back button steps through filter states. The Filters subpage
  // sets it; the pill's × clears it. One axis at a time (decision 3).
  const [searchParams, setSearchParams] = useSearchParams();

  const groups = useMemo(() => (ds ? eraGroupsOf(ds) : []), [ds]);

  async function whatsMissing() {
    if (!ds) return;
    setMode('browse');
    setLoadingGaps(true);
    setGaps(null);
    setGapProgress('');
    setGapError('');
    try {
      const res = await api.findGaps(
        {
          topic: ds.topic,
          description: ds.description,
          subtopics: ds.subtopics,
          items: ds.items,
          domain: ds.domain,
          // Named periods go in so an era-shaped gap comes back named, matching what
          // the Filters screen and the gap-fill call already speak in.
          eraGroups: ds.eraGroups ?? [],
        },
        setGapProgress,
      );
      setGaps(res.gaps);
      setGapSuggestedCount(res.suggestedCount);
    } catch (e: any) {
      setGapError(e?.message ?? 'Gap analysis failed');
    } finally {
      setLoadingGaps(false);
      setGapProgress('');
    }
  }

  /**
   * Re-run the image pipeline over this saved field.
   *
   * Images were only ever resolved while curating, so a field keeps whatever its items
   * were given the day they were made — including a screenshot service's "generating…"
   * placeholder, or a present-day capture standing in for a decades-old design. Every
   * later improvement to sourcing skipped them entirely. This is how those get fixed
   * without re-curating the field and losing the writing.
   *
   * Only items with a real problem are touched: a missing image, one that can't be
   * showing its stated year, or one the scoring layer didn't trust. A confident,
   * period-accurate picture is left exactly as it is.
   */
  async function refetchImages() {
    if (!ds || refetching) return;
    setMode('browse');
    setRefetching(true);
    setRefetchProgress('');
    setRefetchNote('');
    try {
      const res = await api.reResolveImages(
        { datasetId: ds.id, onlyProblems: true },
        setRefetchProgress,
      );
      if (!res.items.length) {
        setRefetchNote('Every image already looks right — nothing to re-fetch.');
        return;
      }
      // Merge by id: only the checked items came back.
      const byId = new Map(res.items.map((i) => [i.id, i]));
      const merged = ds.items.map((i) => byId.get(i.id) ?? i);
      const updated = await saveDataset(ds.id, { items: merged });
      setDs(updated);
      setRefetchNote(
        res.changed
          ? `Replaced ${res.changed} of ${res.checked} image${res.checked === 1 ? '' : 's'}.`
          : `Checked ${res.checked} — nothing better found.`,
      );
    } catch (e: any) {
      setRefetchNote(e?.message ?? 'Re-fetching images failed');
    } finally {
      setRefetching(false);
      setRefetchProgress('');
    }
  }

  const filter = useMemo<ActiveFilter>(() => {
    const sub = searchParams.get('sub');
    if (sub) return { kind: 'subtopic', name: sub };
    const era = searchParams.get('era');
    if (era) {
      const [s, e] = era.split('-').map(Number);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        // Resolve the named group from the dataset; fall back to a bare range label.
        const group = groups.find((g) => g.start === s && g.end === e) ?? {
          label: `${s}–${e}`,
          start: s,
          end: e,
        };
        return { kind: 'era', group };
      }
    }
    return null;
  }, [searchParams, groups]);

  const scope: ScopeQuery = useMemo(() => {
    if (!filter) return {};
    if (filter.kind === 'subtopic') return { subtopics: [filter.name] };
    // An era-group maps to the decade strings the backend scope filters on.
    return { eras: decadesInRange(filter.group.start, filter.group.end) };
  }, [filter]);

  const pool = useMemo(() => {
    if (!ds) return [];
    if (!filter) {
      // No filter — show all items in chronological order (nulls last).
      return [...ds.items].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    }
    if (filter.kind === 'subtopic') return ds.items.filter((it) => it.subtopic === filter.name);
    return itemsInGroup(ds.items, filter.group);
  }, [ds, filter]);

  const filterLabel =
    filter == null ? null : filter.kind === 'subtopic' ? filter.name : filter.group.label;

  if (loadError) return <p className="mt-8 text-[var(--color-accent)]">{loadError}</p>;
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* This field's name, description and in-scope count, pinned to the top-left for
          the whole scroll: on a long wall of images it's the one thing worth never
          losing. It's left-aligned in the margin beside the centred content column, so
          it sits alongside the grid rather than over it. Below md there's no margin to
          sit in, so it scrolls with the page like an ordinary heading. */}
      <div className="md:fixed md:left-4 md:top-3 md:z-30 md:w-48 lg:w-60 xl:w-72">
        <h1 className="serif truncate text-xl leading-tight">{ds.topic}</h1>
        {ds.description && (
          <p className="truncate text-xs text-[var(--color-muted)]">{ds.description}</p>
        )}
        <p className="truncate text-xs text-[var(--color-muted)]">
          {pool.length} of {ds.items.length} items{filterLabel ? ' in scope' : ''}
        </p>
      </div>

      {/* No way back here: the path in the nav bar is the way out. The controls sit on a
          centred line, the same shape as the shelf's — with the pen where the shelf
          keeps its "+". */}
      <header className="relative flex flex-wrap items-center justify-center gap-2 py-4">
        {/* Filters live behind this button — opens the /:domain/:slug/filters subpage. */}
        <Link
          to="filters"
          className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
        >
          Filters
        </Link>
        <button
          onClick={whatsMissing}
          disabled={loadingGaps || !ds}
          className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)] disabled:opacity-40"
        >
          {loadingGaps ? gapProgress || 'Sweeping…' : "What's missing?"}
        </button>
        {/* Digital only: physical items resolve to a stable Wikimedia photo that doesn't
            drift, so there is nothing to re-fetch. */}
        {ds?.domain === 'digital' && (
          <button
            onClick={refetchImages}
            disabled={refetching || !ds}
            title="Re-run the image pipeline over items whose picture is missing, off-era, or low confidence"
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)] disabled:opacity-40"
          >
            {refetching ? refetchProgress || 'Re-fetching…' : 'Re-fetch images'}
          </button>
        )}
        <div className="flex gap-0.5 rounded-full border border-[var(--color-line)] bg-[var(--color-card)] p-0.5">
          {(['browse', 'edit', 'rank', 'leaderboard'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-1 text-sm capitalize ${
                mode === m
                  ? 'bg-[var(--color-ink)] text-[var(--color-wall)]'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Where the shelf's "+" sits, a pen: this field's own name and description are
            edited here, in front of the thing they describe, rather than in a grid of
            inputs on a screen you were only glancing at. */}
        <button
          onClick={() => setEditingMeta((v) => !v)}
          title="Edit this field's name and description"
          aria-label="Edit this field"
          className={`absolute right-0 flex h-9 w-9 items-center justify-center rounded-full shadow-sm transition-transform hover:scale-105 ${
            editingMeta
              ? 'bg-[var(--color-accent)] text-white'
              : 'bg-[var(--color-ink)] text-[var(--color-wall)]'
          }`}
        >
          ✎
        </button>
      </header>

      {editingMeta && (
        <DatasetMeta
          ds={ds}
          domain={domain}
          onSaved={(updated) => {
            setDs(updated);
            setEditingMeta(false);
          }}
          onClose={() => setEditingMeta(false)}
        />
      )}

      {refetchNote && (
        <p className="text-center text-sm text-[var(--color-muted)]">{refetchNote}</p>
      )}

      {/* Active-filter read: a pill with × to clear. The count it used to sit beside now
          lives in the pinned title block, where it stays readable down the page. */}
      {filterLabel && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs text-white">
            {filterLabel}
            <button
              onClick={() => setSearchParams({})}
              aria-label="Clear filter"
              className="text-white/80 hover:text-white"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      {(mode === 'browse' || mode === 'edit') && (
        <Browse
          ds={ds}
          pool={pool}
          gaps={gaps}
          gapSuggestedCount={gapSuggestedCount}
          gapError={gapError}
          editMode={mode === 'edit'}
          onChanged={setDs}
        />
      )}
      {mode === 'rank' && <Rank datasetId={ds.id} scope={scope} poolSize={pool.length} />}
      {mode === 'leaderboard' && <Leaderboard datasetId={ds.id} scope={scope} />}
    </div>
  );
}

/**
 * This field's own name and description, edited in place.
 *
 * The shelf used to carry a mode full of rename inputs, one per dataset. It's here
 * instead because this is the only screen that shows what a field actually contains —
 * renaming "Cars" is a decision you make looking at the cars, not at a card.
 *
 * Deleting lives here too, for the same reason and because otherwise it lives nowhere:
 * it went away with the shelf's edit mode, and a field you can create but never remove
 * is a one-way door.
 */
function DatasetMeta({
  ds,
  domain,
  onSaved,
  onClose,
}: {
  ds: Dataset;
  domain: string;
  onSaved: (ds: Dataset) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState(ds.topic);
  const [description, setDescription] = useState(ds.description);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const trimmedTopic = topic.trim();
  const trimmedDescription = description.trim();
  const changed = trimmedTopic !== ds.topic || trimmedDescription !== ds.description;
  const valid = trimmedTopic !== '' && trimmedDescription !== '';

  async function save() {
    if (!changed || !valid) return;
    setBusy(true);
    setError('');
    try {
      const updated = await saveDataset(ds.id, {
        topic: trimmedTopic,
        description: trimmedDescription,
      });
      // A rename changes the field's address, so the URL has to follow it.
      const slug = slugifyTopic(updated.topic);
      if (slug !== slugifyTopic(ds.topic)) navigate(`/${domain}/${slug}`, { replace: true });
      onSaved(updated);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save');
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${ds.topic}" and all ${ds.items.length} of its items?\n\nThis cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      await deleteDataset(ds.id, ds.topic);
      navigate(`/${domain}`, { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete');
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-[var(--color-accent)] bg-[var(--color-card)] p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">Name</span>
          <input
            className="serif mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-lg"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">Description</span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </label>
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {!valid && (
        <p className="text-sm text-[var(--color-muted)]">
          Both a name and a description are required — the description is what tells the
          curation engine what this field is (2-data.md).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={save}
          disabled={!changed || !valid || busy}
          className="rounded-full bg-[var(--color-ink)] px-5 py-1.5 text-sm text-[var(--color-wall)] disabled:opacity-30"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
        >
          Cancel
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="ml-auto rounded-full border border-[var(--color-accent)] px-4 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-wall-soft)] disabled:opacity-30"
        >
          Delete this field
        </button>
      </div>
    </section>
  );
}

// ---- Browse ----
function Browse({
  ds,
  pool,
  gaps,
  gapSuggestedCount,
  gapError,
  editMode,
  onChanged,
}: {
  ds: Dataset;
  pool: Item[];
  gaps: CoverageGap[] | null;
  gapSuggestedCount: number;
  gapError: string;
  editMode: boolean;
  onChanged: (ds: Dataset) => void;
}) {
  // Inline editing: `editing` holds a working copy of the item being edited; `picker`
  // toggles the image swapper for it; `saving` disables the form during the write.
  const [editing, setEditing] = useState<Item | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  async function removeItem(itemId: string) {
    if (!confirm('Remove this item from the dataset?')) return;
    const updated = await saveDataset(ds.id, {
      items: ds.items.filter((i) => i.id !== itemId),
    });
    onChanged(updated);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await saveDataset(ds.id, {
        items: ds.items.map((i) => (i.id === editing.id ? editing : i)),
      });
      onChanged(updated);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <GapPanel ds={ds} gaps={gaps} suggestedCount={gapSuggestedCount} gapError={gapError} onChanged={onChanged} />

      {pool.length === 0 ? (
        <p className="text-[var(--color-muted)]">No items in this scope.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              />
            ) : (
              <div key={item.id} className="relative">
                {/* The card itself opens the editor — works on touch, not just hover. */}
                <ItemCard item={item} onClick={() => setEditing({ ...item })} />
                {/* Removal is destructive, so it only appears in edit mode — browsing
                    stays a clean wall of images. */}
                {editMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(item.id);
                    }}
                    className="absolute right-2 top-2 rounded-full bg-[var(--color-ink)]/80 px-2 py-1 text-xs text-[var(--color-wall)]"
                  >
                    Remove
                  </button>
                )}
              </div>
            ),
          )}
        </div>
      )}

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
              : { kind: 'search', query: `${editing.name} ${editing.brand}`.trim() }
          }
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

// Inline editor for a saved item — same minimalist form as the curate review grid,
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
}: {
  draft: Item;
  subtopics: Subtopic[];
  domain: Domain;
  saving: boolean;
  onChange: (change: Partial<Item>) => void;
  onSwapImage: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-accent)] bg-[var(--color-card)] p-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
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
      </div>
    </div>
  );
}

// ---- "What's missing?" results panel ----
// Triggered from the header button; receives gap data from DatasetView.
// Manages only the add-items sub-flow: count, feedback, pending items, image picker.
function GapPanel({
  ds,
  gaps,
  suggestedCount,
  gapError,
  onChanged,
}: {
  ds: Dataset;
  gaps: CoverageGap[] | null;
  suggestedCount: number;
  gapError: string;
  onChanged: (ds: Dataset) => void;
}) {
  const [count, setCount] = useState(suggestedCount);
  const [feedback, setFeedback] = useState('');
  const [researching, setResearching] = useState(false);
  const [addProgress, setAddProgress] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<ProposedItem[] | null>(null);
  // What the server had to correct in the batch. Shown rather than swallowed: a
  // proposal dropped as a repeat explains why you asked for 8 and got 6, and an item
  // with no subtopic is one you have to fix before it goes in.
  const [corrections, setCorrections] = useState({ duplicates: 0, unsetSubtopics: 0 });
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [savingAdd, setSavingAdd] = useState(false);
  const [error, setError] = useState('');

  // Sync count when a new gap analysis completes with a fresh suggestion.
  useEffect(() => { setCount(suggestedCount); }, [suggestedCount]);

  async function research() {
    setResearching(true);
    setAddProgress('');
    setError('');
    setNote('');
    setPending(null);
    try {
      const res = await api.fillGaps(
        {
          topic: ds.topic,
          description: ds.description,
          subtopics: ds.subtopics,
          items: ds.items,
          gaps: gaps ?? [],
          count: Math.max(1, Math.min(50, count || 8)),
          feedback,
          domain: ds.domain,
          // Named periods as context, so an added item's year lands inside a real
          // era of the field and an era-shaped gap can be filled by name.
          eraGroups: ds.eraGroups ?? [],
        },
        setAddProgress,
      );
      setPending(res.items);
      setNote(res.note);
      setCorrections({
        duplicates: res.duplicates ?? 0,
        unsetSubtopics: res.unsetSubtopics ?? 0,
      });
    } catch (e: any) {
      setError(e?.message ?? 'Could not research additions');
    } finally {
      setResearching(false);
      setAddProgress('');
    }
  }

  async function addToDataset() {
    if (!pending?.length) return;
    setSavingAdd(true);
    setError('');
    try {
      // Proposed items carry no id/createdAt; the server's PUT handler mints those
      // (toItem). The cast mirrors the curate expansion path's existingItems handling.
      const updated = await saveDataset(ds.id, {
        items: [...ds.items, ...(pending as unknown as Item[])],
      });
      onChanged(updated);
      // Clear the sub-flow; keep the gaps visible so the user can sweep again or add more.
      setPending(null);
      setNote('');
      setFeedback('');
      setCorrections({ duplicates: 0, unsetSubtopics: 0 });
    } catch (e: any) {
      setError(e?.message ?? 'Could not add items');
    } finally {
      setSavingAdd(false);
    }
  }

  const busy = researching || savingAdd;

  if (!gaps && !gapError) return null;

  return (
    <div className="space-y-4">
      {gapError && <p className="text-sm text-[var(--color-accent)]">{gapError}</p>}

      {gaps && (
        <div className="space-y-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-4">
          <div>
            <h3 className="serif text-lg">Coverage gaps</h3>
            {gaps.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No obvious gaps — good coverage.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {gaps.map((g, i) => (
                  <li key={i}>
                    <span className="text-[var(--color-accent)]">{g.axis}:</span> {g.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Research & add the missing items. */}
          <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
            <label className="block">
              <span className="text-sm text-[var(--color-muted)]">
                Your steer <span className="text-[var(--color-muted)]">(optional)</span>
              </span>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. What about the Mona Lisa and other da Vinci works? — weighed against the curation rules, then added or answered."
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-sm text-[var(--color-muted)]">How many to add</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="mt-1 w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <button
                onClick={research}
                disabled={busy}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                {researching ? addProgress || 'Researching…' : `Research ${count} to add →`}
              </button>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              Claude sized this to the gaps — adjust if you like. Researched items are shown for
              review before anything is saved.
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {/* Claude's reply on how it handled your steer + the gaps. */}
      {note && (
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-wall-soft)] p-4 text-sm">
          <h4 className="mb-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">
            How your request was handled
          </h4>
          <p>{note}</p>
        </div>
      )}

      {/* Review the researched items before adding them. */}
      {pending && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="serif text-xl">
                {pending.length} researched — review before adding
              </h3>
              {/* The unfiled count is recounted from the items themselves, not taken
                  from the server's tally, so it goes down as you fix them. */}
              <CorrectionLine
                duplicates={corrections.duplicates}
                unfiled={pending.filter((p) => !p.subtopic).length}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={addToDataset}
                disabled={savingAdd || pending.length === 0}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                {savingAdd ? 'Adding…' : `Add ${pending.length} to dataset`}
              </button>
              <button
                onClick={() => {
                  setPending(null);
                  setNote('');
                  setCorrections({ duplicates: 0, unsetSubtopics: 0 });
                }}
                disabled={savingAdd}
                className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          </div>

          {pending.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              Nothing to add — see the note above for why.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pending.map((it, i) => (
                <ReviewCard
                  key={i}
                  item={it}
                  subtopics={ds.subtopics}
                  domain={ds.domain}
                  onChange={(c) =>
                    setPending((prev) => prev && prev.map((x, j) => (j === i ? { ...x, ...c } : x)))
                  }
                  onSwapImage={() => setPickerIndex(i)}
                  onRemove={() => setPending((prev) => prev && prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {pickerIndex !== null && pending && pending[pickerIndex] && (
        <ImagePicker
          target={
            ds.domain === 'digital'
              ? {
                  kind: 'screenshot',
                  url: pending[pickerIndex].url ?? '',
                  year: pending[pickerIndex].year,
                  name: pending[pickerIndex].name,
                  imageKind: pending[pickerIndex].imageKind,
                  wikipediaTitle: pending[pickerIndex].wikipediaTitle,
                  imageQuery: pending[pickerIndex].imageQuery,
                }
              : {
                  kind: 'search',
                  query: `${pending[pickerIndex].name} ${pending[pickerIndex].brand}`.trim(),
                }
          }
          onPick={(url) => {
            setPending(
              (prev) =>
                prev &&
                prev.map((x, j) => (j === pickerIndex ? { ...x, image: url, capture: undefined } : x)),
            );
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}

/**
 * What the server corrected in a researched batch, said plainly.
 *
 * Both numbers are things the curation prompt asks for and can't enforce — no repeats,
 * and a subtopic from the field's own list. The server fixes them either way; this is
 * so the fix isn't silent. A batch that comes back short is otherwise just a number
 * that doesn't match what you asked for, and an unfiled item is one that would save
 * happily and then never appear under any filter.
 */
function CorrectionLine({ duplicates, unfiled }: { duplicates: number; unfiled: number }) {
  if (!duplicates && !unfiled) return null;
  const parts: string[] = [];
  if (duplicates) {
    parts.push(`${duplicates} dropped as already in the set`);
  }
  if (unfiled) {
    parts.push(`${unfiled} need${unfiled === 1 ? 's' : ''} a subtopic before adding`);
  }
  return <p className="mt-0.5 text-sm text-[var(--color-muted)]">{parts.join(' · ')}</p>;
}

// ---- Rank (1v1 forced choice) ----
// Every choice is filed under a name (lib/ranker.tsx), so this asks for one before
// letting anyone start — otherwise the votes would have nowhere to go.
function Rank({
  datasetId,
  scope,
  poolSize,
}: {
  datasetId: string;
  scope: ScopeQuery;
  poolSize: number;
}) {
  const { ranker } = useRanker();
  const [pair, setPair] = useState<{ a: Item; b: Item } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const scopeKey = JSON.stringify(scope);

  const next = useCallback(async () => {
    if (!ranker) return;
    setLoading(true);
    try {
      const res = await api.getPair(datasetId, ranker, scope);
      setPair(res.pair);
      setProgress(res.progress);
      setError('');
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the next pair');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, scopeKey, ranker?.key]);

  useEffect(() => {
    next();
  }, [next]);

  const choose = useCallback(
    async (winner: Item, loser: Item) => {
      if (!ranker || loading) return;
      setLoading(true);
      try {
        await castVote(datasetId, ranker, winner.id, loser.id);
      } catch (e: any) {
        setError(e?.message ?? 'Could not record that choice');
        setLoading(false);
        return;
      }
      next();
    },
    [datasetId, next, ranker, loading],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!pair) return;
      if (e.key === 'ArrowLeft') choose(pair.a, pair.b);
      if (e.key === 'ArrowRight') choose(pair.b, pair.a);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pair, choose]);

  if (poolSize < 2) {
    return <p className="text-[var(--color-muted)]">Need at least 2 items in scope to rank.</p>;
  }

  if (!ranker) return <NameEntry />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RankerBadge />
        {error && <span className="text-sm text-[var(--color-accent)]">{error}</span>}
      </div>

      {progress && (
        <div>
          <div className="flex justify-between text-sm text-[var(--color-muted)]">
            <span>
              {progress.complete ? 'Ranking ready — keep going if you like' : 'Which is better?'}
            </span>
            <span>
              {progress.done} / {progress.target}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--color-wall-soft)]">
            <div
              className="h-full bg-[var(--color-accent)] transition-all"
              style={{ width: `${Math.min(100, (progress.done / progress.target) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {pair && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Contender item={pair.a} hint="←" onClick={() => choose(pair.a, pair.b)} dim={loading} />
          <Contender item={pair.b} hint="→" onClick={() => choose(pair.b, pair.a)} dim={loading} />
        </div>
      )}
      <p className="text-center text-xs text-[var(--color-muted)]">
        Click the one you prefer, or use ← / →
      </p>
    </div>
  );
}

function Contender({
  item,
  hint,
  onClick,
  dim,
}: {
  item: Item;
  hint: string;
  onClick: () => void;
  dim: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={dim}
      className="group overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] text-left transition-transform hover:-translate-y-0.5 hover:border-[var(--color-accent)]"
    >
      <div className="aspect-[4/3] w-full bg-[var(--color-wall-soft)]">
        <Photo src={item.image} alt={item.name} />
      </div>
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <h3 className="serif text-xl">{item.name}</h3>
          <span className="text-[var(--color-muted)]">{hint}</span>
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          {[item.brand, item.year].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-1 text-sm">{item.description}</p>
      </div>
    </button>
  );
}

// ---- Leaderboard ----
//
// One board per person, plus a pooled one. The name tabs are the whole point: taste
// is personal, so a single merged ranking would flatten exactly the disagreement
// that's interesting to look at. "Everyone" still exists because the consensus is
// worth seeing — it just isn't the only view any more.
function Leaderboard({ datasetId, scope }: { datasetId: string; scope: ScopeQuery }) {
  const { ranker } = useRanker();
  const { data: rankers } = useRankers(datasetId);
  // Default to your own board when you have one — that's the one you came to see.
  const [selected, setSelected] = useState<string | null>(null);

  const known = rankers ?? [];
  const hasOwnBoard = !!ranker && known.some((r) => r.key === ranker.key);
  const active = selected ?? (hasOwnBoard ? (ranker as { key: string }).key : EVERYONE);

  const { data, loading } = useLeaderboard(datasetId, active, scope);
  const rows = data?.leaderboard ?? [];
  const pooled = active === EVERYONE;

  return (
    <div className="space-y-4">
      <RankerTabs
        rankers={known}
        active={active}
        youKey={ranker?.key}
        onSelect={setSelected}
        totalPeople={known.length}
      />

      {loading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[var(--color-muted)]">No items in this scope.</p>
      ) : (
        <>
          {pooled && known.length === 0 && (
            <p className="text-sm text-[var(--color-muted)]">
              Nobody has ranked this field yet — open <strong>Rank</strong>, enter a name, and this
              board fills in.
            </p>
          )}
          <ol className="space-y-2">
            {rows.map((row, i) => (
              <BoardRow key={row.item.id} row={row} place={i + 1} pooled={pooled} />
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** The row of name plates: pooled view first, then everyone who has ranked this field. */
function RankerTabs({
  rankers,
  active,
  youKey,
  onSelect,
  totalPeople,
}: {
  rankers: RankerSummary[];
  active: string;
  youKey?: string;
  onSelect: (key: string) => void;
  totalPeople: number;
}) {
  const tab = (key: string, label: string, sub: string, isYou = false) => (
    <button
      key={key}
      onClick={() => onSelect(key)}
      className={`shrink-0 rounded-xl border px-4 py-2 text-left transition-colors ${
        active === key
          ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
          : 'border-[var(--color-line)] bg-[var(--color-card)] hover:border-[var(--color-accent)]'
      }`}
    >
      <span className="block text-sm font-medium">
        {label}
        {isYou && <span className="ml-1.5 text-xs opacity-70">(you)</span>}
      </span>
      <span className={`block text-xs ${active === key ? 'text-white/75' : 'text-[var(--color-muted)]'}`}>
        {sub}
      </span>
    </button>
  );

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {tab(
        EVERYONE,
        'Everyone',
        totalPeople === 1 ? '1 person' : `${totalPeople} people`,
      )}
      {rankers.map((r) =>
        tab(
          r.key,
          r.name,
          `${r.comparisons} ${r.comparisons === 1 ? 'choice' : 'choices'}`,
          r.key === youKey,
        ),
      )}
    </div>
  );
}

/** Top three get the arcade treatment; everything below is a plain numbered row. */
const PODIUM = ['🥇', '🥈', '🥉'];

function BoardRow({ row, place, pooled }: { row: LeaderboardRow; place: number; pooled: boolean }) {
  const medal = PODIUM[place - 1];
  const { entry, item } = row;
  const unjudged = entry.games === 0;

  return (
    <li
      className={`flex items-center gap-4 rounded-xl border bg-[var(--color-card)] p-3 ${
        medal ? 'border-[var(--color-accent)]/50' : 'border-[var(--color-line)]'
      } ${unjudged ? 'opacity-60' : ''}`}
    >
      <span className="serif w-8 shrink-0 text-center text-2xl text-[var(--color-muted)]">
        {medal ?? place}
      </span>
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
        <Photo src={item.image} alt={item.name} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{item.name}</p>
        <p className="truncate text-sm text-[var(--color-muted)]">
          {[item.brand, item.year].filter(Boolean).join(' · ')}
        </p>
      </div>
      {/* On the pooled board, how many people actually judged this — the honest read
          on whether a high placing is a consensus or one person's single opinion. */}
      {pooled && !unjudged && (
        <Chip>
          {row.rankerCount} {row.rankerCount === 1 ? 'voter' : 'voters'}
        </Chip>
      )}
      <Chip>{eraOf(item.year)}</Chip>
      <span className="serif w-16 shrink-0 text-right text-lg">
        {unjudged ? '—' : entry.rating}
      </span>
    </li>
  );
}
