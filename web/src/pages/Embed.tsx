import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DOMAINS, DOMAIN_LABELS, isCuratedDomain } from '../../../shared/types';
import type { DatasetSummary, Domain, EmbedDataset } from '../../../shared/types';
import { api } from '../lib/api';
import { Photo } from '../components/Photo';

// The worlds this widget will ever offer — personal is hand-built and never public
// (9-personal-and-auth.md; the server 404s it outright, see routes/embed.ts).
const WORLDS = DOMAINS.filter(isCuratedDomain);

type Step =
  | { kind: 'world' }
  | { kind: 'dataset'; domain: Domain }
  | { kind: 'browse'; ds: EmbedDataset; index: number };

/**
 * The whole point of this page (main.tsx routes it outside the app's Nav/layout
 * shell): a bare, iframeable, SELF-CONTAINED picture widget — `<iframe src=".../embed">`
 * on any other site, sized however the embedder likes. No app chrome, no auth, no
 * dataset-specific URL to hand-build: paste the one generic src once, and the widget
 * itself walks pick-a-world -> pick-a-dataset -> browse-with-shuffle. Change the
 * iframe's width/height and that's the entire integration surface.
 *
 * `/embed/:domain/:slug` and `/embed/:datasetId` still work as direct deep links into
 * the browse step for one specific dataset (skipping the picker) — useful for a site
 * that always wants the same field, e.g. a permanent "wallpaper" of one collection.
 */
export function Embed() {
  const { datasetId, slug } = useParams();
  const deepLink = slug ?? datasetId ?? '';

  const [step, setStep] = useState<Step>({ kind: 'world' });
  const [datasets, setDatasets] = useState<DatasetSummary[] | null>(null);
  const [error, setError] = useState('');

  const openDataset = useCallback((id: string) => {
    setError('');
    api
      .getEmbed(id)
      .then((ds) => {
        setStep({ kind: 'browse', ds, index: Math.floor(Math.random() * Math.max(ds.items.length, 1)) });
      })
      .catch((e: any) => setError(e?.message ?? 'Could not load this dataset'));
  }, []);

  // A deep-linked embed skips straight to browsing — no picker shown at all.
  useEffect(() => {
    if (deepLink) openDataset(deepLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink]);

  function openWorld(domain: Domain) {
    setError('');
    setDatasets(null);
    setStep({ kind: 'dataset', domain });
    api.listDatasets(domain).catch((e: any) => {
      setError(e?.message ?? 'Could not load datasets');
      return [] as DatasetSummary[];
    }).then(setDatasets);
  }

  // Never repeats the picture on screen when there's more than one to pick from.
  const shuffle = useCallback(() => {
    setStep((s) => {
      if (s.kind !== 'browse' || s.ds.items.length < 2) return s;
      let next = s.index;
      while (next === s.index) next = Math.floor(Math.random() * s.ds.items.length);
      return { ...s, index: next };
    });
  }, []);

  // A deep-linked embed that failed to load shows only the error — never the picker,
  // which would just invite browsing to something else instead of what was linked.
  if (deepLink && error && step.kind !== 'browse') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-wall)] p-4 text-center text-sm text-[var(--color-muted)]">
        {error}
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[var(--color-wall)]">
      {step.kind === 'world' && <WorldPicker onPick={openWorld} />}
      {step.kind === 'dataset' && (
        <DatasetPicker
          domain={step.domain}
          datasets={datasets}
          error={error}
          onBack={() => setStep({ kind: 'world' })}
          onPick={openDataset}
        />
      )}
      {step.kind === 'browse' && (
        <Browse
          ds={step.ds}
          index={step.index}
          onShuffle={shuffle}
          onBack={deepLink ? undefined : () => setStep({ kind: 'world' })}
        />
      )}
    </div>
  );
}

// ---- Step 1: pick a world ----
function WorldPicker({ onPick }: { onPick: (domain: Domain) => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <p className="mb-1 text-sm text-[var(--color-muted)]">Browse</p>
      {WORLDS.map((domain) => (
        <button
          key={domain}
          onClick={() => onPick(domain)}
          className="w-full max-w-xs rounded-full bg-[var(--color-ink)] px-5 py-2.5 text-sm text-[var(--color-wall)] hover:opacity-90"
        >
          {DOMAIN_LABELS[domain].title}
        </button>
      ))}
    </div>
  );
}

// ---- Step 2: pick a dataset within that world ----
function DatasetPicker({
  domain,
  datasets,
  error,
  onBack,
  onPick,
}: {
  domain: Domain;
  datasets: DatasetSummary[] | null;
  error: string;
  onBack: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <div className="flex h-full w-full flex-col p-4">
      <button onClick={onBack} className="mb-2 self-start text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">
        ← {DOMAIN_LABELS[domain].title}
      </button>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {!error && datasets === null && (
        <p className="text-sm text-[var(--color-muted)]">Loading…</p>
      )}
      {datasets && datasets.length === 0 && (
        <p className="text-sm text-[var(--color-muted)]">No datasets yet in {DOMAIN_LABELS[domain].title}.</p>
      )}
      <div className="flex-1 space-y-2 overflow-y-auto">
        {datasets?.map((d) => (
          <button
            key={d.id}
            onClick={() => onPick(d.id)}
            className="block w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] px-3 py-2 text-left text-sm hover:bg-[var(--color-wall-soft)]"
          >
            {d.topic}
            <span className="ml-1 text-xs text-[var(--color-muted)]">({d.itemCount})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Step 3: browse one dataset, shuffling through its pictures ----
function Browse({
  ds,
  index,
  onShuffle,
  onBack,
}: {
  ds: EmbedDataset;
  index: number;
  onShuffle: () => void;
  /** Absent for a deep-linked embed — there's no picker to go back to. */
  onBack?: () => void;
}) {
  if (ds.items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-[var(--color-muted)]">
        {ds.topic} has no pictures yet.
      </div>
    );
  }

  const item = ds.items[index];

  return (
    <div className="relative h-full w-full">
      {onBack && (
        <button
          onClick={onBack}
          aria-label="Choose a different dataset"
          title="Choose a different dataset"
          className="absolute left-3 top-3 z-10 rounded-full bg-[var(--color-ink)]/70 px-3 py-1.5 text-xs text-[var(--color-wall)] backdrop-blur hover:bg-[var(--color-ink)]"
        >
          ← {ds.topic}
        </button>
      )}
      <button
        onClick={onShuffle}
        disabled={ds.items.length < 2}
        aria-label="Show another picture"
        title="Shuffle"
        className="absolute right-3 top-3 z-10 rounded-full bg-[var(--color-ink)]/70 p-2 text-[var(--color-wall)] backdrop-blur transition hover:bg-[var(--color-ink)] disabled:opacity-0"
      >
        <ShuffleIcon />
      </button>
      <div className="absolute bottom-3 left-3 z-10 max-w-[70%] truncate rounded-full bg-[var(--color-ink)]/60 px-3 py-1 text-xs text-[var(--color-wall)] backdrop-blur">
        {item.name}
        {item.year ? ` · ${item.year}` : ''}
      </div>
      <button onClick={onShuffle} className="block h-full w-full cursor-pointer" aria-label="Shuffle">
        <Photo src={item.image} alt={item.name} className="h-full w-full" />
      </button>
    </div>
  );
}

function ShuffleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="M15 15l6 6" />
      <path d="M4 4l5 5" />
    </svg>
  );
}
