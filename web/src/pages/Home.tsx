import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import type { DatasetSummary } from '../../../shared/types';
import { api } from '../lib/api';
import { useDomain } from '../lib/domain';

// Datasets home — the shelf (6-ui.md), scoped to one domain (7-software-design.md).
export function Home() {
  const { domain } = useDomain();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!domain) return;
    setLoading(true);
    try {
      setDatasets(await api.listDatasets(domain));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  async function remove(id: string, topic: string) {
    if (!confirm(`Delete the "${topic}" dataset? This cannot be undone.`)) return;
    await api.deleteDataset(id);
    load();
  }

  // No domain chosen (direct nav, back button, or a fresh reload) — back to the gate.
  if (!domain) return <Navigate to="/" replace />;

  return (
    <div>
      <header className="mb-8 mt-4">
        <h1 className="serif text-4xl capitalize">Your {domain} fields</h1>
        <p className="mt-2 max-w-2xl text-[var(--color-muted)]">
          Each dataset is a field of human work. Build one, browse it, then train your eye by
          choosing the better of two.
        </p>
      </header>

      {loading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : datasets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] p-12 text-center">
          <p className="text-[var(--color-muted)]">No datasets yet.</p>
          <Link
            to="/new"
            className="mt-4 inline-block rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)]"
          >
            + New dataset
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {datasets.map((ds) => (
            <div
              key={ds.id}
              className="group relative rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
            >
              <Link to={`/dataset/${ds.id}`} className="block">
                <h2 className="serif text-2xl leading-tight">{ds.topic}</h2>
                <p className="mt-2 line-clamp-2 text-sm text-[var(--color-muted)]">
                  {ds.description}
                </p>
                <p className="mt-4 text-xs text-[var(--color-muted)]">
                  {ds.itemCount} items · {ds.subtopicCount} subtopics
                </p>
              </Link>
              <button
                onClick={() => remove(ds.id, ds.topic)}
                className="absolute right-3 top-3 hidden rounded-full px-2 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)] group-hover:block"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
