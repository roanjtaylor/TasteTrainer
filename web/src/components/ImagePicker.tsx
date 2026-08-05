import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { ImageCandidate, ImageKind } from '../../../shared/types';
import { sourceLabel } from './CaptureBadge';

interface SearchTarget {
  kind: 'search';
  query: string;
}
interface ScreenshotTarget {
  kind: 'screenshot';
  url: string;
  year: number | null;
  /** The item's own hints, so the picker can consult every source the pipeline does —
   *  without them a pre-web item has nothing but an empty Wayback grid to offer. */
  name?: string;
  imageKind?: ImageKind;
  wikipediaTitle?: string;
  imageQuery?: string;
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
  // Candidates carry their source and score; a plain search only has urls. Both render
  // through the same grid, so the extra provenance simply goes missing rather than
  // needing a second component.
  const [images, setImages] = useState<ImageCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState('');

  const bare = (urls: string[]): ImageCandidate[] =>
    urls.map((url) => ({ url, source: 'ddg', confidence: 'medium' }));

  async function search(q: string) {
    setLoading(true);
    try {
      const res = await api.searchImages(q);
      setImages(bare(res.images));
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  /** Runs the same cascade curation runs — the web archive, Wikipedia, Commons, the
   *  Internet Archive software library and image search — so what you pick from is what
   *  the pipeline would have chosen between, labelled and scored. */
  async function findCandidates(url: string, y: number | null) {
    if (target.kind !== 'screenshot') return;
    setLoading(true);
    try {
      const res = await api.imageCandidates({
        name: target.name ?? '',
        year: y,
        kind: target.imageKind,
        url,
        wikipediaTitle: target.wikipediaTitle,
        query: target.imageQuery,
      });
      setImages(res.candidates);
    } catch {
      setImages([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (target.kind === 'search' && target.query.trim()) search(target.query);
    // No url is no longer a dead end: a pre-web item has no site to capture and is
    // exactly the case that most needs the other sources.
    if (target.kind === 'screenshot') findCandidates(target.url, target.year);
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
              onClick={() => findCandidates(siteUrl, year)}
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
            {images.map((c) => (
              <button
                key={c.url}
                onClick={() => onPick(c.url)}
                title={c.note ? `${sourceLabel(c.source)} · ${c.note}` : sourceLabel(c.source)}
                className="overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-wall-soft)] hover:ring-2 hover:ring-[var(--color-accent)]"
              >
                <img src={c.url} alt="" className="aspect-square w-full object-cover" />
                {/* Provenance under each thumbnail: these come from very different
                    places, and "the web archive at 2001" deserves more trust than an
                    unattributed search hit. Only shown when the source is known. */}
                {target.kind === 'screenshot' && (
                  <span className="block truncate px-1.5 py-1 text-[10px] leading-tight text-[var(--color-muted)]">
                    {sourceLabel(c.source)}
                    {c.year ? ` ${c.year}` : ''}
                    {c.width ? ` · ${c.width}×${c.height}` : ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-[var(--color-muted)]">
            {target.kind === 'screenshot'
              ? 'Nothing found — try a different url/year or search phrase, or paste an image URL below.'
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
