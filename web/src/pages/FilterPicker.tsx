import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { EraGroup } from '../../../shared/types';
import { useDataset } from '../lib/data';
import { EraTimeline } from '../components/EraTimeline';
import { SubtopicFans } from '../components/SubtopicFans';

// The Filters subpage (6-ui.md): pick a slice by SUBTOPIC or by ERA — the dataset's
// two independent axes. An item lives on both at once, which is why they're separate
// views rather than one tree, and why only one can be active at a time.
//
// Both halves existed before this screen used them: the fan cards were built and left
// unimported, and the era scope was implemented end to end on the server but had no UI
// that could set it. This is where they get connected.
type Axis = 'subtopic' | 'era';

export function FilterPicker() {
  const { domain = '', slug = '' } = useParams();
  const navigate = useNavigate();
  const [axis, setAxis] = useState<Axis>('subtopic');
  // Shares the dataset view's cache entry, so arriving here from the Filters button
  // renders straight away instead of re-fetching what was on screen a moment ago.
  const { data: ds, error } = useDataset(slug || null);

  function chooseSubtopic(subtopic: string) {
    navigate(`/${domain}/${slug}?sub=${encodeURIComponent(subtopic)}`);
  }

  // The era scope travels as `start-end` — the same shape the dataset view parses
  // back into a named period (DatasetView's `filter`).
  function chooseEra(group: EraGroup) {
    navigate(`/${domain}/${slug}?era=${group.start}-${group.end}`);
  }

  if (error) return <p className="mt-8 text-[var(--color-accent)]">{error}</p>;
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`/${domain}/${slug}`} className="text-sm text-[var(--color-muted)]">
            ← {ds.topic}
          </Link>
          <h1 className="serif text-4xl">Filters</h1>
          <p className="mt-1 max-w-2xl text-[var(--color-muted)]">
            {axis === 'subtopic'
              ? 'Pick a theme to browse, rank, and rate.'
              : 'Pick a period to browse, rank, and rate.'}
          </p>
        </div>
        <div className="flex gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-card)] p-1">
          {(['subtopic', 'era'] as Axis[]).map((a) => (
            <button
              key={a}
              onClick={() => setAxis(a)}
              className={`rounded-full px-4 py-1.5 text-sm capitalize ${
                axis === a
                  ? 'bg-[var(--color-ink)] text-[var(--color-wall)]'
                  : 'text-[var(--color-muted)]'
              }`}
            >
              {a}
            </button>
          ))}
        </div>
      </header>

      {axis === 'subtopic' ? (
        <SubtopicFans ds={ds} onSelect={chooseSubtopic} />
      ) : (
        <EraTimeline ds={ds} onSelect={chooseEra} />
      )}
    </div>
  );
}
