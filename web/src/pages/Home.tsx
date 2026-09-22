import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { isCuratedDomain, slugifyTopic, type DatasetSummary } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { prefetchDataset, useDatasetList, useWorldMap } from '../lib/data';
import { cardsFor } from '../lib/mapLayout';
import { WorldMapCanvas, WorldMapSections } from '../components/WorldMapCanvas';
import { NavActions } from '../lib/navActions';
import { useChatView } from '../lib/chatView';
import { WORLD_PROMPTS } from '../components/chat/ChatDock';

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
  // The personal world has no map (9-personal-and-auth.md) — it is always the plain grid.
  const curated = !!domain && isCuratedDomain(domain);
  const { data: map } = useWorldMap(curated ? domain : null);
  // Mapping and reviewing a world is Claude's work: these buttons just open the dock
  // with the ask written out, for you to send or reword (lib/chatView.tsx).
  const { ask } = useChatView();

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
      {!curated && (
        // Only the personal world has a form to fill: its collections are hand-built,
        // and there is no map here whose gaps could start one. In the researched worlds
        // a new field comes from asking Claude, so there is no button to add.
        <NavActions>
          <Link
            to={`/${domain}/new`}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            + New dataset
          </Link>
        </NavActions>
      )}

      {error ? (
        <p className="text-[var(--color-accent)]">{error}</p>
      ) : loading ? (
        <p className="text-[var(--color-muted)]">Loading…</p>
      ) : datasets?.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--color-line)] p-12 text-center">
          <p className="text-[var(--color-muted)]">No datasets yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-muted)]">
            {curated
              ? 'Ask Claude to map this world and pick from the fields it finds.'
              : 'Start a collection of your own — books, films, albums, family memories — and fill it with your files. Everything here stays private to you.'}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {curated ? (
              <button
                onClick={() => ask(WORLD_PROMPTS.fields)}
                className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)]"
              >
                Ask Claude to map this world →
              </button>
            ) : (
              <Link
                to={`/${domain}/new`}
                className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)]"
              >
                + New dataset
              </Link>
            )}
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
          {curated && !hasMap && (
            <p className="mb-4 text-sm text-[var(--color-muted)]">
              This world has no map yet.{' '}
              <button onClick={() => ask(WORLD_PROMPTS.draw)} className="text-[var(--color-accent)] underline">
                Ask Claude to draw it
              </button>{' '}
              — how this world divides, and what's missing from it.
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
      className={`relative ${CARD}`}
      // Fetch the dataset while the pointer is on its way to the click — by the time
      // the route changes it's usually already cached, so the dataset view opens
      // without a loading state at all.
      onMouseEnter={() => prefetchDataset(slug)}
      onFocus={() => prefetchDataset(slug)}
    >
      {ds.private && (
        <span
          className="absolute right-4 top-4 text-[var(--color-muted)]"
          aria-label="Private — requires sign-in to view"
          title="Private — requires sign-in to view"
        >
          <LockIcon />
        </span>
      )}
      <Link to={`/${domain}/${slug}`} className="block">
        <h2 className="serif text-2xl leading-tight pr-6">{ds.topic}</h2>
        <p className="mt-2 line-clamp-2 text-sm text-[var(--color-muted)]">{ds.description}</p>
        <p className="mt-4 text-xs text-[var(--color-muted)]">
          {ds.itemCount} items · {ds.subtopicCount} subtopics
        </p>
      </Link>
    </div>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
