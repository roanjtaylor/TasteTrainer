import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { Dataset } from '../../../shared/types';
import { api } from '../lib/api';
import { EraTimeline } from '../components/EraTimeline';

export function FilterPicker() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [ds, setDs] = useState<Dataset | null>(null);

  useEffect(() => {
    api.getDataset(id).then(setDs);
  }, [id]);

  function choose(subtopic: string) {
    navigate(`/dataset/${id}?sub=${encodeURIComponent(subtopic)}`);
  }

  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <header className="mt-4">
        <Link to={`/dataset/${id}`} className="text-sm text-[var(--color-muted)]">
          ← {ds.topic}
        </Link>
        <h1 className="serif text-4xl">Filters</h1>
        <p className="mt-1 max-w-2xl text-[var(--color-muted)]">
          Pick a theme to browse, rank, and rate.
        </p>
      </header>
      <EraTimeline ds={ds} onSelect={choose} />
    </div>
  );
}
