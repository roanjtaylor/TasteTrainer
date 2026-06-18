import { useEffect, useState } from 'react';
import { api } from '../lib/api';

// The 3x3 DuckDuckGo picker (4-images.md): swap an item's image by clicking one
// of the first 9 results, or paste a URL directly.
export function ImagePicker({
  initialQuery,
  onPick,
  onClose,
}: {
  initialQuery: string;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState('');

  async function search(q: string) {
    setLoading(true);
    try {
      const res = await api.searchImages(q);
      setImages(res.images);
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQuery.trim()) search(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex gap-2">
          <input
            className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(query)}
            placeholder="Search images…"
          />
          <button
            className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-wall)]"
            onClick={() => search(query)}
          >
            Search
          </button>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">Searching…</p>
        ) : images.length ? (
          <div className="grid grid-cols-3 gap-2">
            {images.map((url) => (
              <button
                key={url}
                onClick={() => onPick(url)}
                className="aspect-square overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-wall-soft)] hover:ring-2 hover:ring-[var(--color-accent)]"
              >
                <img src={url} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">
            No results — try a different search, or paste a URL below.
          </p>
        )}

        <div className="mt-4 flex gap-2 border-t border-[var(--color-line)] pt-4">
          <input
            className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="…or paste an image URL"
          />
          <button
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm"
            disabled={!manual.trim()}
            onClick={() => onPick(manual.trim())}
          >
            Use URL
          </button>
        </div>
      </div>
    </div>
  );
}
