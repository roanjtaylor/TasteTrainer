import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { EVERYONE } from '../../../shared/types';
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
import { saveDataset, useDataset, useLeaderboard, useRankers, vote as castVote } from '../lib/data';
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

  const [gaps, setGaps] = useState<CoverageGap[] | null>(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [gapProgress, setGapProgress] = useState('');
  const [gapSuggestedCount, setGapSuggestedCount] = useState(8);
  const [gapError, setGapError] = useState('');

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
      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`/${domain}`} className="text-sm text-[var(--color-muted)]">
            ← all fields
          </Link>
          <h1 className="serif text-4xl">{ds.topic}</h1>
          <p className="mt-1 max-w-2xl text-[var(--color-muted)]">{ds.description}</p>
        </div>
        <div className="flex items-center gap-2">
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
          <div className="flex gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-card)] p-1">
            {(['browse', 'rank', 'leaderboard'] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`rounded-full px-4 py-1.5 text-sm capitalize ${
                  mode === m
                    ? 'bg-[var(--color-ink)] text-[var(--color-wall)]'
                    : 'text-[var(--color-muted)]'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Active-filter read: a pill (with × to clear) + the in-scope count. */}
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--color-muted)]">
        {filterLabel && (
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
        )}
        <span>
          {pool.length} of {ds.items.length} items{filterLabel ? ' in scope' : ''}
        </span>
      </div>

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
              ? { kind: 'screenshot', url: editing.url ?? '', year: editing.year }
              : { kind: 'search', query: `${editing.name} ${editing.brand}`.trim() }
          }
          onPick={(url) => {
            setEditing((e) => (e ? { ...e, image: url } : e));
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
        },
        setAddProgress,
      );
      setPending(res.items);
      setNote(res.note);
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
            <h3 className="serif text-xl">
              {pending.length} researched — review before adding
            </h3>
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
              ? { kind: 'screenshot', url: pending[pickerIndex].url ?? '', year: pending[pickerIndex].year }
              : {
                  kind: 'search',
                  query: `${pending[pickerIndex].name} ${pending[pickerIndex].brand}`.trim(),
                }
          }
          onPick={(url) => {
            setPending((prev) => prev && prev.map((x, j) => (j === pickerIndex ? { ...x, image: url } : x)));
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
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
