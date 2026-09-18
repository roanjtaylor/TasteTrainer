import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { EmbedDataset } from '../../../shared/types';
import { api } from '../lib/api';
import { Photo } from '../components/Photo';

/**
 * The whole point of this page (main.tsx routes it outside the app's Nav/layout
 * shell): a bare, iframeable picture viewer — `<iframe src=".../embed/physical/paintings">`
 * on any other site, sized however the embedder likes. No app chrome, no auth, and a
 * shuffle button so it reads as a changing wallpaper rather than one static image.
 *
 * The `:domain` segment is along for the ride, not resolved against anything — the
 * server looks datasets up by slug alone (storage.ts's getDataset tries id, then
 * slug, and slugs are unique across the whole shelf), so it exists purely so the
 * embed URL matches the app's own /:domain/:slug shape and is easy to hand-write.
 * `/embed/:datasetId` (bare id or slug, no domain) still works too, for anything
 * already using a raw id.
 */
export function Embed() {
  const { datasetId, slug } = useParams();
  const identifier = slug ?? datasetId ?? '';
  const [ds, setDs] = useState<EmbedDataset | null>(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .getEmbed(identifier)
      .then((d) => {
        if (cancelled) return;
        setDs(d);
        setIndex(Math.floor(Math.random() * Math.max(d.items.length, 1)));
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? 'Could not load this dataset');
      });
    return () => {
      cancelled = true;
    };
  }, [identifier]);

  // Never repeats the picture on screen when there's more than one to pick from.
  const shuffle = useCallback(() => {
    setDs((current) => {
      if (current && current.items.length > 1) {
        setIndex((prev) => {
          let next = prev;
          while (next === prev) next = Math.floor(Math.random() * current.items.length);
          return next;
        });
      }
      return current;
    });
  }, []);

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-wall)] p-4 text-center text-sm text-[var(--color-muted)]">
        {error}
      </div>
    );
  }
  if (!ds) {
    return <div className="h-screen w-screen bg-[var(--color-wall)]" />;
  }
  if (ds.items.length === 0) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[var(--color-wall)] p-4 text-center text-sm text-[var(--color-muted)]">
        {ds.topic} has no pictures yet.
      </div>
    );
  }

  const item = ds.items[index];

  return (
    <div className="relative h-screen w-screen bg-[var(--color-wall)]">
      <button
        onClick={shuffle}
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
      <button onClick={shuffle} className="block h-full w-full cursor-pointer" aria-label="Shuffle">
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
