import type { ImageCandidate } from '../../../shared/types';
import { sourceLabel } from './CaptureBadge';

// The alternatives the image cascade found and scored, offered inline whenever the
// chosen one wasn't high-confidence (services/imageResolvers.ts).
//
// Why this exists rather than just leaving the picker: the pipeline already did the
// expensive part — it queried the web archive, Wikipedia, Commons, the Internet Archive
// software library and image search, then measured and scored every result. Throwing
// that away and making you re-run a search by hand is how a wrong-but-plausible image
// ends up saved: the fix is technically available and costs enough attention that it
// doesn't happen. Here the second-best candidate is one click, with its source and
// score stated so the choice is informed rather than a guess between thumbnails.
export function CandidateStrip({
  candidates,
  chosen,
  onPick,
}: {
  candidates: ImageCandidate[];
  chosen: string;
  onPick: (url: string) => void;
}) {
  const others = candidates.filter((c) => c.url !== chosen);
  if (!others.length) return null;

  return (
    <div className="mt-2">
      <p className="mb-1 text-xs text-[var(--color-muted)]">
        {others.length} other candidate{others.length === 1 ? '' : 's'} found — click to use
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {others.map((c) => (
          <button
            key={c.url}
            onClick={() => onPick(c.url)}
            title={`${sourceLabel(c.source)} · ${c.confidence} confidence${
              c.width ? ` · ${c.width}×${c.height}` : ''
            }${c.note ? ` · ${c.note}` : ''}`}
            className="w-24 shrink-0 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-wall-soft)] text-left hover:ring-2 hover:ring-[var(--color-accent)]"
          >
            <img src={c.url} alt="" className="h-16 w-full object-cover" loading="lazy" />
            <span className="block truncate px-1.5 py-1 text-[10px] leading-tight text-[var(--color-muted)]">
              {sourceLabel(c.source)}
              {c.year ? ` ${c.year}` : ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
