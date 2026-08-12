import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { slugifyTopic, type DatasetSummary } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { prefetchDataset, useDatasetList, useWorldMap } from '../lib/data';
import { cardsFor } from '../lib/mapLayout';
import { WorldMapCanvas, WorldMapSections } from '../components/WorldMapCanvas';
import { ResumeBanner } from '../components/ResumeBanner';
import { NavActions } from '../lib/navActions';

// Datasets home — one world's fields (6-ui.md, 7-software-design.md), addressed by
// the world: /physical, /digital.
//
// The default view is the MAP (8-field-map.md): fields sit in named regions on two
// meaningful axes, and fields you haven't built yet appear as dashed holes. A world
// with no map yet falls back to a plain grid of cards instead.
//
// This screen no longer edits anything. Renaming and deleting a field happen inside
// that field (pages/DatasetView.tsx), where you can see what you're changing — a shelf
// full of rename inputs asked you to edit things you were only glancing at.
export function Home() {
  const domain = useDomain();
  const { data: datasets, loading, error } = useDatasetList(domain);
  const { data: map } = useWorldMap(domain);

  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 700,
  );

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 700);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const cards = useMemo(
    () =>
      map && datasets
        ? cardsFor(
            domain ?? '',
            datasets.map((d) => ({
              id: d.id,
              topic: d.topic,
              description: d.description,
              itemCount: d.itemCount,
            })),
            map.ghosts,
            slugifyTopic,
          )
        : [],
    [map, datasets, domain],
  );

  // Not a world (a typo'd URL, an old /datasets link) — back to the gate.
  if (!domain) return <Navigate to="/" replace />;

  const hasMap = !!map && map.regions.length > 0;
  const showMap = hasMap;

  return (
    // No page title: the nav bar reads as a path (TasteTrainer / Physical), which
    // already says where you are, and the map wants the height more than this screen
    // wanted a heading of its own.
    <div>
      {!loading && !error && (datasets?.length ?? 0) > 0 && (
        <NavActions>
          <Link
            to={`/${domain}/review`}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            {hasMap ? 'Review' : 'Check this world'}
          </Link>
        </NavActions>
      )}

      <ResumeBanner domain={domain} />

      {error ? (
        <p className="text-[var(--color-accent)]">{error}</p>
      ) : loading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : datasets?.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] p-12 text-center">
          <p className="text-[var(--color-muted)]">No datasets yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-muted)]">
            Name a field yourself, or let Claude map this world first and pick from the fields
            it finds.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link
              to={`/${domain}/new`}
              className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)]"
            >
              + New dataset
            </Link>
            <Link
              to={`/${domain}/review`}
              className="rounded-full border border-[var(--color-line)] px-5 py-2 text-sm"
            >
              Map this world →
            </Link>
          </div>
        </div>
      ) : showMap ? (
        narrow ? (
          <WorldMapSections map={map!} cards={cards} />
        ) : (
          <WorldMapCanvas map={map!} cards={cards} />
        )
      ) : (
        <>
          {!hasMap && (
            <p className="mb-4 text-sm text-[var(--color-muted)]">
              This world has no map yet.{' '}
              <Link to={`/${domain}/review`} className="text-[var(--color-accent)] underline">
                Check this world
              </Link>{' '}
              to see how it divides and what's missing from it.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(datasets ?? []).map((ds) => (
              <ShelfCard key={ds.id} ds={ds} domain={domain} />
            ))}
          </div>
        </>
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
