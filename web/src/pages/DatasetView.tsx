import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import type { CoverageGap, Dataset, EloEntry, Item, Subtopic } from '../../../shared/types';
import { api, type Progress, type ScopeQuery } from '../lib/api';
import { eraOf, erasOf } from '../lib/format';
import { ItemCard, Chip } from '../components/ItemCard';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';

type Mode = 'browse' | 'rank' | 'leaderboard';

// The Dataset view (6-ui.md): browse the items, pick a scope, run the 1v1
// forced choice, and see the leaderboard — all one screen.
export function DatasetView() {
  const { id = '' } = useParams();
  const [ds, setDs] = useState<Dataset | null>(null);
  const [mode, setMode] = useState<Mode>('browse');

  // Scope (shared across browse / rank / leaderboard).
  const [selSubtopics, setSelSubtopics] = useState<Set<string>>(new Set());
  const [selEras, setSelEras] = useState<Set<string>>(new Set());

  useEffect(() => {
    api.getDataset(id).then(setDs);
  }, [id]);

  const eras = useMemo(() => (ds ? erasOf(ds.items) : []), [ds]);

  const scope: ScopeQuery = useMemo(
    () => ({ subtopics: [...selSubtopics], eras: [...selEras] }),
    [selSubtopics, selEras],
  );

  const pool = useMemo(() => {
    if (!ds) return [];
    return ds.items.filter(
      (it) =>
        (selSubtopics.size === 0 || selSubtopics.has(it.subtopic)) &&
        (selEras.size === 0 || selEras.has(eraOf(it.year))),
    );
  }, [ds, selSubtopics, selEras]);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set);
    next.has(value) ? next.delete(value) : next.add(value);
    setter(next);
  }

  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-[var(--color-muted)]">
            ← all fields
          </Link>
          <h1 className="serif text-4xl">{ds.topic}</h1>
          <p className="mt-1 max-w-2xl text-[var(--color-muted)]">{ds.description}</p>
        </div>
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
      </header>

      {/* Scope picker */}
      <section className="space-y-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Subtopic</span>
          {ds.subtopics.map((s) => (
            <FilterChip
              key={s.name}
              active={selSubtopics.has(s.name)}
              onClick={() => toggle(selSubtopics, setSelSubtopics, s.name)}
            >
              {s.name}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Era</span>
          {eras.map((e) => (
            <FilterChip key={e} active={selEras.has(e)} onClick={() => toggle(selEras, setSelEras, e)}>
              {e}
            </FilterChip>
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          {pool.length} of {ds.items.length} items in scope
          {selSubtopics.size + selEras.size > 0 && (
            <button
              className="ml-2 underline"
              onClick={() => {
                setSelSubtopics(new Set());
                setSelEras(new Set());
              }}
            >
              clear
            </button>
          )}
        </p>
      </section>

      {mode === 'browse' && <Browse ds={ds} pool={pool} onChanged={setDs} />}
      {mode === 'rank' && <Rank datasetId={ds.id} scope={scope} poolSize={pool.length} />}
      {mode === 'leaderboard' && <Leaderboard datasetId={ds.id} scope={scope} />}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs transition-colors ${
        active
          ? 'bg-[var(--color-accent)] text-white'
          : 'border border-[var(--color-line)] text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]'
      }`}
    >
      {children}
    </button>
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
  const [gaps, setGaps] = useState<CoverageGap[] | null>(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [gapProgress, setGapProgress] = useState('');

  // Inline editing: `editing` holds a working copy of the item being edited; `picker`
  // toggles the image swapper for it; `saving` disables the form during the write.
  const [editing, setEditing] = useState<Item | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  async function whatsMissing() {
    setLoadingGaps(true);
    setGaps(null);
    setGapProgress('');
    try {
      const res = await api.findGaps(
        {
          topic: ds.topic,
          description: ds.description,
          subtopics: ds.subtopics,
          items: ds.items,
        },
        setGapProgress,
      );
      setGaps(res.gaps);
    } finally {
      setLoadingGaps(false);
      setGapProgress('');
    }
  }

  async function removeItem(itemId: string) {
    if (!confirm('Remove this item from the dataset?')) return;
    const updated = await api.updateDataset(ds.id, {
      items: ds.items.filter((i) => i.id !== itemId),
    });
    onChanged(updated);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await api.updateDataset(ds.id, {
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
      <div className="flex justify-end">
        <button
          onClick={whatsMissing}
          disabled={loadingGaps}
          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm disabled:opacity-40"
        >
          {loadingGaps ? gapProgress || 'Sweeping the field…' : "What's missing?"}
        </button>
      </div>

      {gaps && (
        <div className="rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-4">
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
      )}

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
                saving={saving}
                onChange={(c) => setEditing((e) => (e ? { ...e, ...c } : e))}
                onSwapImage={() => setPicker(true)}
                onSave={saveEdit}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div key={item.id} className="group relative">
                <ItemCard item={item} />
                <div className="absolute right-2 top-2 hidden gap-1 group-hover:flex">
                  <button
                    onClick={() => setEditing({ ...item })}
                    className="rounded-full bg-[var(--color-ink)]/80 px-2 py-1 text-xs text-[var(--color-wall)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="rounded-full bg-[var(--color-ink)]/80 px-2 py-1 text-xs text-[var(--color-wall)]"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      )}

      {picker && editing && (
        <ImagePicker
          initialQuery={`${editing.name} ${editing.brand}`.trim()}
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
  saving,
  onChange,
  onSwapImage,
  onSave,
  onCancel,
}: {
  draft: Item;
  subtopics: Subtopic[];
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
      <ItemFields item={draft} subtopics={subtopics} onChange={onChange} />
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

// ---- Rank (1v1 forced choice) ----
function Rank({
  datasetId,
  scope,
  poolSize,
}: {
  datasetId: string;
  scope: ScopeQuery;
  poolSize: number;
}) {
  const [pair, setPair] = useState<{ a: Item; b: Item } | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [loading, setLoading] = useState(false);

  const scopeKey = JSON.stringify(scope);

  const next = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getPair(datasetId, scope);
      setPair(res.pair);
      setProgress(res.progress);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, scopeKey]);

  useEffect(() => {
    next();
  }, [next]);

  const choose = useCallback(
    async (winner: Item, loser: Item) => {
      await api.vote(datasetId, winner.id, loser.id);
      next();
    },
    [datasetId, next],
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

  return (
    <div className="space-y-5">
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
function Leaderboard({ datasetId, scope }: { datasetId: string; scope: ScopeQuery }) {
  const [rows, setRows] = useState<Array<{ item: Item; entry: EloEntry }>>([]);
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    api.getLeaderboard(datasetId, scope).then((res) => setRows(res.leaderboard));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId, scopeKey]);

  if (rows.length === 0) return <p className="text-[var(--color-muted)]">No items in this scope.</p>;

  return (
    <ol className="space-y-2">
      {rows.map((row, i) => (
        <li
          key={row.item.id}
          className="flex items-center gap-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3"
        >
          <span className="serif w-8 text-center text-2xl text-[var(--color-muted)]">{i + 1}</span>
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
            {row.item.image && (
              <img src={row.item.image} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{row.item.name}</p>
            <p className="truncate text-sm text-[var(--color-muted)]">
              {[row.item.brand, row.item.year].filter(Boolean).join(' · ')}
            </p>
          </div>
          <Chip>{eraOf(row.item.year)}</Chip>
          <span className="serif w-16 text-right text-lg">{row.entry.rating}</span>
        </li>
      ))}
    </ol>
  );
}
