import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { DOMAIN_LABELS, slugifyTopic, type DatasetSummary } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { deleteDataset, prefetchDataset, saveDataset, useDatasetList } from '../lib/data';

// Datasets home — the shelf (6-ui.md), scoped to one world (7-software-design.md)
// and addressed by it: /physical, /digital.
//
// Renaming and deleting live behind the nav's "Edit datasets" toggle (?edit=1)
// rather than on hover. Hover-to-reveal put a destructive control one stray click
// from every card you were merely reading; a mode you have to ask for doesn't.
export function Home() {
  const domain = useDomain();
  const [params] = useSearchParams();
  const editing = params.get('edit') === '1';
  const { data: datasets, loading, error, refresh } = useDatasetList(domain);

  // Not a world (a typo'd URL, an old /datasets link) — back to the gate.
  if (!domain) return <Navigate to="/" replace />;

  return (
    <div>
      <header className="mb-8 mt-4 flex items-end justify-between gap-3">
        <h1 className="serif text-4xl">{DOMAIN_LABELS[domain].title} fields</h1>
        {editing && (
          <Link
            to={`/${domain}`}
            className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            Done editing
          </Link>
        )}
      </header>

      {error ? (
        <p className="text-[var(--color-accent)]">{error}</p>
      ) : loading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : datasets?.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] p-12 text-center">
          <p className="text-[var(--color-muted)]">No datasets yet.</p>
          <Link
            to={`/${domain}/new`}
            className="mt-4 inline-block rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)]"
          >
            + New dataset
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(datasets ?? []).map((ds) =>
            editing ? (
              <EditCard key={ds.id} ds={ds} onChanged={refresh} />
            ) : (
              <ShelfCard key={ds.id} ds={ds} domain={domain} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

const CARD = 'rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5';

function ShelfCard({ ds, domain }: { ds: DatasetSummary; domain: string }) {
  const slug = slugifyTopic(ds.topic);
  return (
    <div
      className={CARD}
      // Fetch the dataset while the pointer is on its way to the click — by the time
      // the route changes it's usually already cached, so the dataset view opens
      // without a loading state at all.
      onMouseEnter={() => prefetchDataset(slug)}
      onFocus={() => prefetchDataset(slug)}
    >
      <Link to={`/${domain}/${slug}`} className="block">
        <h2 className="serif text-2xl leading-tight">{ds.topic}</h2>
        <p className="mt-2 line-clamp-2 text-sm text-[var(--color-muted)]">{ds.description}</p>
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          {ds.itemCount} items · {ds.subtopicCount} subtopics
        </p>
      </Link>
    </div>
  );
}

/** The same card in edit mode: the title becomes the input that renames it. Not a
 *  link — in this mode a click is meant to land in the field, not navigate away. */
function EditCard({ ds, onChanged }: { ds: DatasetSummary; onChanged: () => void }) {
  const [topic, setTopic] = useState(ds.topic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const trimmed = topic.trim();
  const renamed = trimmed !== ds.topic && trimmed !== '';

  async function rename() {
    if (!renamed) return;
    setBusy(true);
    setError('');
    try {
      await saveDataset(ds.id, { topic: trimmed });
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Rename failed');
      setTopic(ds.topic);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // Typed confirmation would be friction on a shelf; the mode is the guard, and the
    // name in the prompt is what makes "which one" unambiguous.
    if (!confirm(`Delete the "${ds.topic}" dataset? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteDataset(ds.id, ds.topic);
      onChanged();
    } catch (e: any) {
      setError(e?.message ?? 'Delete failed');
      setBusy(false);
    }
  }

  return (
    <div className={`${CARD} border-dashed`}>
      <input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && rename()}
        disabled={busy}
        aria-label={`Rename ${ds.topic}`}
        className="serif w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-1.5 text-2xl leading-tight outline-none focus:border-[var(--color-accent)]"
      />
      <p className="mt-2 line-clamp-2 text-sm text-[var(--color-muted)]">{ds.description}</p>
      {error && <p className="mt-2 text-sm text-[var(--color-accent)]">{error}</p>}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={rename}
          disabled={!renamed || busy}
          className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm text-[var(--color-wall)] disabled:opacity-30"
        >
          {busy ? 'Saving…' : 'Rename'}
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm text-[var(--color-accent)] hover:bg-[var(--color-wall-soft)] disabled:opacity-30"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
