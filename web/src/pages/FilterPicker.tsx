import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import type { Dataset, EraGroup } from '../../../shared/types';
import { api } from '../lib/api';
import { SubtopicFans } from '../components/SubtopicFans';
import { EraTimeline } from '../components/EraTimeline';

type Axis = 'subtopic' | 'era';

// The Filters subpage (6-ui.md): a delightful way into a filtered All view. Two axes
// you switch between — SUBTOPIC (fanned card collections) and ERA (a timeline of named
// periods). Picking either drills into /dataset/:id with the filter encoded in the URL.
export function FilterPicker() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [ds, setDs] = useState<Dataset | null>(null);
  const [axis, setAxis] = useState<Axis>('subtopic');

  useEffect(() => {
    api.getDataset(id).then(setDs);
  }, [id]);

  function chooseSubtopic(name: string) {
    navigate(`/dataset/${id}?sub=${encodeURIComponent(name)}`);
  }
  function chooseEra(group: EraGroup) {
    navigate(`/dataset/${id}?era=${group.start}-${group.end}`);
  }

  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      <header className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`/dataset/${id}`} className="text-sm text-[var(--color-muted)]">
            ← {ds.topic}
          </Link>
          <h1 className="serif text-4xl">Filters</h1>
          <p className="mt-1 max-w-2xl text-[var(--color-muted)]">
            Pick a slice to browse, rank, and rate.
          </p>
        </div>
        {/* Axis switch: SUBTOPIC | ERA */}
        <div className="flex gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-card)] p-1">
          {(['subtopic', 'era'] as Axis[]).map((a) => (
            <button
              key={a}
              onClick={() => setAxis(a)}
              className={`rounded-full px-4 py-1.5 text-sm uppercase tracking-wide ${
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
        <EraTimeline ds={ds} onSelect={chooseEra} onChanged={setDs} />
      )}
    </div>
  );
}
