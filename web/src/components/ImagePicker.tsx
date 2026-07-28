import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface SearchTarget {
  kind: 'search';
  query: string;
}
interface ScreenshotTarget {
  kind: 'screenshot';
  url: string;
  year: number | null;
}

// The image swap picker: a grid of candidates, click one to set the item's image, or
// paste a URL directly. Two sourcing modes (7-software-design.md):
// - 'search' — the 3x3 DuckDuckGo picker (4-images.md), for physical-world items.
// - 'screenshot' — nearby Wayback/live screenshots for a site url + optional target
//   year, for digital-world items (DuckDuckGo image search is meaningless for "this
//   exact site, this exact year"). Same grid/manual-paste UI either way.
export function ImagePicker({
  target,
  onPick,
  onClose,
}: {
  target: SearchTarget | ScreenshotTarget;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(target.kind === 'search' ? target.query : '');
  const [siteUrl, setSiteUrl] = useState(target.kind === 'screenshot' ? target.url : '');
  const [year, setYear] = useState<number | null>(target.kind === 'screenshot' ? target.year : null);
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

  async function findScreenshots(url: string, y: number | null) {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const res = await api.screenshotCandidates(url, y);
      setImages(res.images);
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (target.kind === 'search' && target.query.trim()) search(target.query);
    if (target.kind === 'screenshot' && target.url.trim()) findScreenshots(target.url, target.year);
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
        {target.kind === 'search' ? (
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
        ) : (
          <div className="mb-3 flex gap-2">
            <input
              className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              placeholder="Site url, e.g. https://stripe.com"
            />
            <input
              className="w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
              type="number"
              value={year ?? ''}
              onChange={(e) => setYear(e.target.value ? Number(e.target.value) : null)}
              placeholder="year"
            />
            <button
              className="rounded-lg bg-[var(--color-ink)] px-4 py-2 text-sm text-[var(--color-wall)]"
              onClick={() => findScreenshots(siteUrl, year)}
            >
              Find
            </button>
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">
            {target.kind === 'screenshot' ? 'Capturing…' : 'Searching…'}
          </p>
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
            {target.kind === 'screenshot'
              ? 'No snapshots found — try a different url/year, or paste an image URL below.'
              : 'No results — try a different search, or paste a URL below.'}
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
