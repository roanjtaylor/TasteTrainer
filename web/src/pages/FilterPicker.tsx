import { useNavigate, useParams, Link } from 'react-router-dom';
import { useDataset } from '../lib/data';
import { EraTimeline } from '../components/EraTimeline';

export function FilterPicker() {
  const { domain = '', slug = '' } = useParams();
  const navigate = useNavigate();
  // Shares the dataset view's cache entry, so arriving here from the Filters button
  // renders straight away instead of re-fetching what was on screen a moment ago.
  const { data: ds, error } = useDataset(slug || null);

  function choose(subtopic: string) {
    navigate(`/${domain}/${slug}?sub=${encodeURIComponent(subtopic)}`);
  }

  if (error) return <p className="mt-8 text-[var(--color-accent)]">{error}</p>;
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <header className="mt-4">
        <Link to={`/${domain}/${slug}`} className="text-sm text-[var(--color-muted)]">
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
