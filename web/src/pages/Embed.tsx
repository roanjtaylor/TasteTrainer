import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { DOMAINS, DOMAIN_LABELS, isCuratedDomain } from '../../../shared/types';
import type { DatasetSummary, Domain, EmbedDataset } from '../../../shared/types';
import { api } from '../lib/api';
import { thumbSrcSet } from '../lib/image';
import { Photo } from '../components/Photo';
import { Mosaic } from '../components/Mosaic';

// The worlds this widget will ever offer — personal is hand-built and never public
// (9-personal-and-auth.md; the server 404s it outright, see routes/embed.ts).
const WORLDS = DOMAINS.filter(isCuratedDomain);

/** The single-picture view fills the iframe, so the iframe's width is the slot. */
const SINGLE_SIZES = '100vw';

type Step =
  | { kind: 'world' }
  | { kind: 'dataset'; domain: Domain }
  // `next` is the picture the following shuffle will land on — chosen ahead of time so
  // it can be fetched while this one is being looked at (see Browse's preload).
  | { kind: 'browse'; ds: EmbedDataset; index: number; next: number };

/** A random index other than `not` — or `not` itself when there's nothing else. */
function randomOther(count: number, not: number): number {
  if (count < 2) return not;
  let i = not;
  while (i === not) i = Math.floor(Math.random() * count);
  return i;
}

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
        const index = Math.floor(Math.random() * Math.max(ds.items.length, 1));
        setStep({ kind: 'browse', ds, index, next: randomOther(ds.items.length, index) });
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
      return { ...s, index: s.next, next: randomOther(s.ds.items.length, s.next) };
    });
  }, []);

  // Picking a tile in the mosaic (below) jumps straight to it, same as landing on
  // it by shuffle — one index, shared by both ways of looking.
  const openIndex = useCallback((index: number) => {
    setStep((s) =>
      s.kind === 'browse' ? { ...s, index, next: s.next === index ? randomOther(s.ds.items.length, index) : s.next } : s,
    );
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
          next={step.next}
          onShuffle={shuffle}
          onOpenIndex={openIndex}
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

// ---- Step 3: browse one dataset — either one picture at a time (shuffle) or the
// whole field at once (a zoomable/pannable mosaic of every picture, Mosaic.tsx) ----
function Browse({
  ds,
  index,
  next,
  onShuffle,
  onOpenIndex,
  onBack,
}: {
  ds: EmbedDataset;
  index: number;
  /** Where the next shuffle lands — fetched ahead so the swap is instant. */
  next: number;
  onShuffle: () => void;
  /** Tapping a tile in the mosaic jumps single-picture view to that one. */
  onOpenIndex: (index: number) => void;
  /** Absent for a deep-linked embed — there's no picker to go back to. */
  onBack?: () => void;
}) {
  const [mode, setMode] = useState<'single' | 'mosaic'>('single');

  // Warm the cache with the next shuffle's picture. Same srcset + sizes as the Photo
  // that will show it, so the browser picks — and later reuses — the same file.
  const nextImage = mode === 'single' && next !== index ? ds.items[next]?.image : undefined;
  useEffect(() => {
    if (!nextImage) return;
    const img = new Image();
    const srcSet = thumbSrcSet(nextImage);
    if (srcSet) {
      img.sizes = SINGLE_SIZES;
      img.srcset = srcSet;
    }
    img.src = nextImage;
  }, [nextImage]);

  if (ds.items.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-[var(--color-muted)]">
        {ds.topic} has no pictures yet.
      </div>
    );
  }

  const item = ds.items[index];
  const canMosaic = ds.items.length > 1;

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

      {canMosaic && (
        <div className="absolute right-3 top-3 z-10 flex gap-1.5">
          {mode === 'single' ? (
            <>
              <button
                onClick={() => setMode('mosaic')}
                aria-label="See every picture at once"
                title="See every picture at once"
                className="rounded-full bg-[var(--color-ink)]/70 p-2 text-[var(--color-wall)] backdrop-blur transition hover:bg-[var(--color-ink)]"
              >
                <MosaicIcon />
              </button>
              <button
                onClick={onShuffle}
                aria-label="Show another picture"
                title="Shuffle"
                className="rounded-full bg-[var(--color-ink)]/70 p-2 text-[var(--color-wall)] backdrop-blur transition hover:bg-[var(--color-ink)]"
              >
                <ShuffleIcon />
              </button>
            </>
          ) : (
            <button
              onClick={() => setMode('single')}
              aria-label="Back to one picture"
              title="Back to one picture"
              className="rounded-full bg-[var(--color-ink)]/70 p-2 text-[var(--color-wall)] backdrop-blur transition hover:bg-[var(--color-ink)]"
            >
              <SingleIcon />
            </button>
          )}
        </div>
      )}

      {mode === 'mosaic' ? (
        <Mosaic items={ds.items} onOpenItem={(i) => { onOpenIndex(i); setMode('single'); }} />
      ) : (
        <>
          <div className="absolute bottom-3 left-3 z-10 max-w-[70%] truncate rounded-full bg-[var(--color-ink)]/60 px-3 py-1 text-xs text-[var(--color-wall)] backdrop-blur">
            {item.name}
            {item.year ? ` · ${item.year}` : ''}
          </div>
          <button onClick={onShuffle} className="block h-full w-full cursor-pointer" aria-label="Shuffle">
            <Photo src={item.image} alt={item.name} className="h-full w-full" sizes={SINGLE_SIZES} />
          </button>
        </>
      )}
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

function MosaicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function SingleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="9.5" cy="10" r="1.5" fill="currentColor" stroke="none" />
      <path d="m5 17 4.5-5 3 3 3.5-4 3 3.5" />
    </svg>
  );
}
