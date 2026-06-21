// Combined filter view: subtopics as equal-width bands, sorted chronologically.
// 1) Mini fan cards (3 images, fanned) above the band
// 2) Hoverable / clickable subtopic band (abbreviated name · count · description)
// 3) Bar chart: each era's slot divided into equal-width decade bars; y = item count.
//    Vertical dividers + start-year labels at era boundaries; "present" at the right edge.
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Dataset, Item } from '../../../shared/types';
import { Photo } from './Photo';

type Group = { name: string; description: string; start: number; end: number };
type Bar   = { xPct: number; wPct: number; count: number };

// Display-only: first token before " & " or " the " keeps names to one word/phrase.
function shortName(name: string): string {
  return name.split(/\s+&\s+|\s+the\s+/i)[0].trim();
}

export function EraTimeline({
  ds,
  onSelect,
}: {
  ds: Dataset;
  onSelect: (subtopicName: string) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const bandBtns = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const pinRef = useRef<HTMLDivElement>(null);
  const [centers, setCenters] = useState<number[]>([]);

  function highlight(i: number) {
    setHovered(i);
    const btn = bandBtns.current[i];
    const graph = graphRef.current;
    if (btn && graph) {
      const b = btn.getBoundingClientRect();
      const g = graph.getBoundingClientRect();
      setBox({ left: b.left - g.left, width: b.width });
    }
  }
  function clearHighlight() {
    setHovered(null);
    setBox(null);
  }

  const { groups, bars, maxBarCount, countByGroup, itemsBySubtopic } = useMemo(() => {
    // Single O(items) pass: build all per-subtopic data structures at once.
    const bySubAndDecade = new Map<string, Map<number, number>>();
    const countByGroup = new Map<string, number>(ds.subtopics.map((s) => [s.name, 0]));
    const itemsBySubtopic = new Map<string, Item[]>(ds.subtopics.map((s) => [s.name, []]));
    const yearsBySubtopic = new Map<string, number[]>(ds.subtopics.map((s) => [s.name, []]));

    for (const item of ds.items) {
      countByGroup.set(item.subtopic, (countByGroup.get(item.subtopic) ?? 0) + 1);
      const arr = itemsBySubtopic.get(item.subtopic);
      if (arr) arr.push(item); else itemsBySubtopic.set(item.subtopic, [item]);
      if (item.year == null) continue;
      const yarr = yearsBySubtopic.get(item.subtopic);
      if (yarr) yarr.push(item.year); else yearsBySubtopic.set(item.subtopic, [item.year]);
      const d = Math.floor(item.year / 10) * 10;
      if (!bySubAndDecade.has(item.subtopic)) bySubAndDecade.set(item.subtopic, new Map());
      const dm = bySubAndDecade.get(item.subtopic)!;
      dm.set(d, (dm.get(d) ?? 0) + 1);
    }

    // Sort groups chronologically by each subtopic's earliest item year.
    const groups: Group[] = ds.subtopics.map((s) => {
      const years = yearsBySubtopic.get(s.name) ?? [];
      return {
        name: s.name,
        description: s.description,
        start: years.length ? Math.min(...years) : 0,
        end:   years.length ? Math.max(...years) + 1 : 1,
      };
    }).sort((a, b) => a.start - b.start);

    const N = groups.length;
    const slot = 100 / Math.max(1, N); // percent width per era

    // One bar per decade per group; each era's slot divided equally by its decade count.
    const bars: Bar[] = [];
    let maxBarCount = 1;

    for (let gi = 0; gi < N; gi++) {
      const g = groups[gi];
      const dm = bySubAndDecade.get(g.name);
      const firstD = Math.floor(g.start / 10) * 10;
      const lastD  = Math.floor(Math.max(g.start, g.end - 1) / 10) * 10;
      const numD   = Math.max(1, (lastD - firstD) / 10 + 1);
      const dSlot  = slot / numD; // percent width per decade within this era

      for (let di = 0; di < numD; di++) {
        const d     = firstD + di * 10;
        const count = dm?.get(d) ?? 0;
        bars.push({ xPct: gi * slot + di * dSlot, wPct: dSlot, count });
        if (count > maxBarCount) maxBarCount = count;
      }
    }

    return { groups, bars, maxBarCount, countByGroup, itemsBySubtopic };
  }, [ds.subtopics, ds.items]);

  useLayoutEffect(() => {
    function measure() {
      const pin = pinRef.current;
      if (!pin) return;
      const p = pin.getBoundingClientRect();
      setCenters(
        bandBtns.current.map((btn) => {
          if (!btn) return 0;
          const b = btn.getBoundingClientRect();
          return b.left - p.left + b.width / 2;
        }),
      );
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (pinRef.current) ro.observe(pinRef.current);
    return () => ro.disconnect();
  }, [groups.length]);

  if (groups.length === 0) {
    return (
      <p className="text-[var(--color-muted)]">
        No subtopics yet — curate some to explore by theme.
      </p>
    );
  }

  const slot = 100 / groups.length;
  const W = 1000, H = 140, padY = 12;
  const xOf = (pct: number) => (pct / 100) * W;
  const wOf = (pct: number) => (pct / 100) * W;
  const yOf = (count: number) => H - (count / maxBarCount) * (H - padY);

  function handleGraphMove(e: { clientX: number }) {
    const btns = bandBtns.current;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i]?.getBoundingClientRect();
      if (b && e.clientX >= b.left && e.clientX < b.right) {
        if (i !== hovered) highlight(i);
        return;
      }
    }
    const g = graphRef.current?.getBoundingClientRect();
    if (!g) return;
    const next = Math.min(groups.length - 1, Math.max(0, Math.floor(((e.clientX - g.left) / g.width) * groups.length)));
    if (next !== hovered) highlight(next);
  }

  return (
    <div className="space-y-5">
      <div className="relative w-full select-none">

        {/* ── Fan cards ── centred above each subtopic slot */}
        <div ref={pinRef} className="relative mb-1 h-32">
          {groups.map((g, i) => (
            <button
              key={g.name}
              onClick={() => onSelect(g.name)}
              onMouseEnter={() => highlight(i)}
              onMouseLeave={clearHighlight}
              title={g.name}
              className="absolute bottom-0 -translate-x-1/2 transition-transform hover:-translate-y-0.5"
              style={
                centers[i] != null
                  ? { left: `${centers[i]}px` }
                  : { left: `${(i + 0.5) * slot}%` }
              }
            >
              <MiniFan items={itemsBySubtopic.get(g.name) ?? []} />
            </button>
          ))}
        </div>

        {/* ── Subtopic band ── */}
        <div className="flex w-full divide-x divide-[var(--color-line)] overflow-hidden rounded-t-lg border border-b-0 border-[var(--color-line)]">
          {groups.map((g, i) => {
            const n = countByGroup.get(g.name) ?? 0;
            const active = hovered === i;
            return (
              <button
                key={g.name}
                ref={(el) => { bandBtns.current[i] = el; }}
                onClick={() => onSelect(g.name)}
                onMouseEnter={() => highlight(i)}
                onMouseLeave={clearHighlight}
                className={`flex min-h-[5.5rem] flex-1 basis-0 flex-col items-center justify-start gap-0.5 px-2 py-2.5 text-center transition-colors ${
                  active
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-card)] text-[var(--color-ink)] hover:bg-[var(--color-wall-soft)]'
                }`}
              >
                <span className="serif text-sm leading-tight">{shortName(g.name)}</span>
                <span className={`text-xs ${active ? 'text-white/80' : 'text-[var(--color-muted)]'}`}>
                  {n} {n === 1 ? 'item' : 'items'}
                </span>
                <p className={`mt-0.5 line-clamp-2 text-[10px] leading-snug ${active ? 'text-white/70' : 'text-[var(--color-muted)]'}`}>
                  {g.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* ── Bar chart ── */}
        {bars.some((b) => b.count > 0) && (
          <div
            ref={graphRef}
            onMouseMove={handleGraphMove}
            onMouseLeave={clearHighlight}
            className="relative overflow-hidden rounded-b-lg border border-t-0 border-[var(--color-line)] bg-[var(--color-card)]"
          >
            {box && (
              <div
                className="pointer-events-none absolute inset-y-0 bg-[var(--color-accent)]/10"
                style={{ left: `${box.left}px`, width: `${box.width}px` }}
              />
            )}
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-36 w-full">
              {/* Vertical dividers at era boundaries */}
              {groups.map((_, i) =>
                i > 0 ? (
                  <line
                    key={i}
                    x1={((i * slot) / 100) * W} y1={0}
                    x2={((i * slot) / 100) * W} y2={H}
                    stroke="var(--color-line)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : null,
              )}
              {/* One bar per decade, width proportional to era's decade count */}
              {bars.map((b, idx) =>
                b.count > 0 ? (
                  <rect
                    key={idx}
                    x={xOf(b.xPct)}
                    y={yOf(b.count)}
                    width={Math.max(1, wOf(b.wPct) - 0.5)}
                    height={H - yOf(b.count)}
                    fill="var(--color-accent)"
                    opacity={0.75}
                    rx={1}
                  />
                ) : null,
              )}
            </svg>
            {/* Year labels at the left edge of each era; "present" at the right */}
            <div className="relative h-5 border-t border-[var(--color-line)]">
              {groups.map((g, i) => (
                <span
                  key={g.name}
                  className="absolute top-0.5 text-[10px] text-[var(--color-muted)]"
                  style={{
                    left: `${i * slot}%`,
                    transform: i === 0 ? 'none' : 'translateX(-50%)',
                  }}
                >
                  {g.start}
                </span>
              ))}
              <span className="absolute right-0 top-0.5 text-[10px] text-[var(--color-muted)]">
                present
              </span>
            </div>
          </div>
        )}
      </div>

      <p className="text-center text-xs text-[var(--color-muted)]">
        Click a theme to browse, rank, and see the leaderboard for that slice.
      </p>
    </div>
  );
}

// Three cards fanned from a shared bottom hinge — SubtopicFans aesthetic at compact size.
// Memoized: items arrays come from useMemo (stable references), so MiniFan never
// re-renders on hover — only when the dataset itself changes.
const MiniFan = memo(function MiniFan({ items }: { items: Item[] }) {
  const shown = items.slice(0, 3);
  const more  = items.length - shown.length;
  const n     = shown.length;

  if (n === 0) {
    return (
      <div className="flex h-28 w-24 items-center justify-center rounded-xl border border-dashed border-[var(--color-line)] text-[10px] text-[var(--color-muted)]">
        no items
      </div>
    );
  }

  return (
    <div className="relative flex h-28 w-24 items-end justify-center">
      {shown.map((it, i) => {
        const offset = i - (n - 1) / 2;
        return (
          <div
            key={it.id}
            className="absolute bottom-0 h-24 w-14 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] shadow-sm"
            style={{
              transform: `translateX(${offset * 26}px) rotate(${offset * 10}deg)`,
              transformOrigin: 'bottom center',
              zIndex: i,
            }}
          >
            <Photo src={it.image} alt={it.name} />
          </div>
        );
      })}
      {more > 0 && (
        <span className="absolute bottom-1 right-0 z-10 translate-x-2 rounded-full bg-[var(--color-ink)]/80 px-1.5 py-0.5 text-[10px] text-[var(--color-wall)]">
          +{more} more
        </span>
      )}
    </div>
  );
});
