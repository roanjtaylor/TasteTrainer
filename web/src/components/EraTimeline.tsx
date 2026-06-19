// The ERA view of the Filters subpage (6-ui.md): a horizontal timeline of the field's
// history. Top half = a works-per-decade line graph with a key work pinned per period;
// bottom half = a band of named era-groups you hover (to highlight its span) and click
// to drill into that slice. Era-groups are AI-generated per dataset; when absent, a
// century-bucket fallback renders, and a "Generate periods" button fills them in.
//
// Interactive zoom-to-year is intentionally NOT built here — deferred post-MVP
// (decision 8 in the plan). The static timeline + era-group band is the MVP.
import { useLayoutEffect, useRef, useState } from 'react';
import type { Dataset, EraGroup } from '../../../shared/types';
import { api } from '../lib/api';
import { decadeCounts, eraGroupsOf, itemsInGroup, keyWorkOf } from '../lib/format';
import { Photo } from './Photo';

export function EraTimeline({
  ds,
  onSelect,
  onChanged,
}: {
  ds: Dataset;
  onSelect: (group: EraGroup) => void;
  onChanged: (ds: Dataset) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // The graph highlight is sized from the ACTUAL hovered band button (measured in px),
  // not a computed slot %, so it lines up exactly despite the band's border/dividers.
  const graphRef = useRef<HTMLDivElement>(null);
  const bandBtns = useRef<(HTMLButtonElement | null)[]>([]);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);

  // Pinned-work positions are measured from the real band-button centres too, so each
  // key work sits exactly above its era. Re-measured on layout changes (resize/regen).
  const pinRef = useRef<HTMLDivElement>(null);
  const [centers, setCenters] = useState<number[]>([]);

  // Highlight era `i`: position the graph overlay over that era's button box.
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

  const groups = eraGroupsOf(ds);
  const counts = decadeCounts(ds.items);
  const hasAiGroups = !!ds.eraGroups?.length;

  // Measure each band button's centre (px, relative to the pinned-works row, which
  // shares the band's left edge) so the pinned images can be centred exactly above
  // their era. ResizeObserver keeps it correct across viewport/layout changes.
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

  async function generate() {
    setBusy(true);
    setProgress('');
    setError('');
    try {
      const res = await api.generatePeriods(
        { topic: ds.topic, description: ds.description, items: ds.items },
        setProgress,
      );
      const updated = await api.updateDataset(ds.id, { eraGroups: res.eraGroups });
      onChanged(updated);
    } catch (e: any) {
      setError(e?.message ?? 'Could not generate periods');
    } finally {
      setBusy(false);
      setProgress('');
    }
  }

  if (counts.length === 0 || groups.length === 0) {
    return (
      <div className="space-y-4">
        <GenerateBar
          hasAiGroups={hasAiGroups}
          busy={busy}
          progress={progress}
          onGenerate={generate}
        />
        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
        <p className="text-[var(--color-muted)]">
          No dated items yet — add years to items to populate the timeline.
        </p>
      </div>
    );
  }

  // Shared year→percent scale so the graph, pinned works, and band all line up. The
  // BANDED x-scale: each era-group occupies an EQUAL slot (1/N of the width) so the
  // graph lines up with the equal-width band of buttons below — the slice above each
  // button is exactly that era's, making "which eras hold more work" read at a glance.
  // Within its slot a year is placed proportionally to the era's own span, so time
  // still flows left→right inside each period.
  const slot = 100 / groups.length;
  const pct = (year: number) => {
    let idx = groups.findIndex((g) => year >= g.start && year < g.end);
    if (idx === -1) idx = year < groups[0].start ? 0 : groups.length - 1;
    const g = groups[idx];
    const frac = Math.min(1, Math.max(0, (year - g.start) / Math.max(1, g.end - g.start)));
    return (idx + frac) * slot;
  };

  // Graph geometry in a fixed viewBox, stretched to the container width.
  const W = 1000;
  const H = 160;
  const padY = 14;
  const maxCount = Math.max(1, ...counts.map((c) => c.count));
  const xOf = (year: number) => (pct(year) / 100) * W;
  // 0 sits on the absolute bottom (y = H); only the TOP gets padding so the tallest
  // bar isn't clipped. (Previously 0 mapped to H - padY, leaving a filled band that
  // read as content where there was none.)
  const yOf = (count: number) => H - (count / maxCount) * (H - padY);
  const linePts = counts.map((c) => `${xOf(c.decade + 5).toFixed(1)},${yOf(c.count).toFixed(1)}`);
  const areaPts = [
    `${xOf(counts[0].decade + 5).toFixed(1)},${H}`,
    ...linePts,
    `${xOf(counts[counts.length - 1].decade + 5).toFixed(1)},${H}`,
  ].join(' ');

  // Hovering anywhere over the graph highlights the era column under the cursor — so
  // image, graph, and button are all responsive. The era is found from the real band
  // button rects (with an equal-column fallback for the 1px gaps between them).
  function handleGraphMove(e: { clientX: number }) {
    const btns = bandBtns.current;
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i]?.getBoundingClientRect();
      if (b && e.clientX >= b.left && e.clientX < b.right) {
        highlight(i);
        return;
      }
    }
    const g = graphRef.current?.getBoundingClientRect();
    if (!g) return;
    const frac = (e.clientX - g.left) / g.width;
    highlight(Math.min(groups.length - 1, Math.max(0, Math.floor(frac * groups.length))));
  }

  return (
    <div className="space-y-5">
      <GenerateBar
        hasAiGroups={hasAiGroups}
        busy={busy}
        progress={progress}
        onGenerate={generate}
      />
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {/* ---- Top half: pinned key works + line graph ---- */}
      <div className="relative w-full select-none">
        {/* Key work pinned per era-group, centred over that era's button (measured). */}
        <div ref={pinRef} className="relative mb-1 h-24">
          {groups.map((g, i) => {
            const work = keyWorkOf(ds.items, g);
            if (!work) return null;
            return (
              <button
                key={i}
                onClick={() => onSelect(g)}
                onMouseEnter={() => highlight(i)}
                onMouseLeave={clearHighlight}
                title={`${work.name}${work.year ? ` · ${work.year}` : ''}`}
                className="absolute bottom-0 h-20 w-16 -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-card)] shadow-sm transition-transform hover:-translate-y-0.5"
                style={centers[i] != null ? { left: `${centers[i]}px` } : { left: `${(i + 0.5) * slot}%` }}
              >
                <Photo src={work.image} alt={work.name} />
              </button>
            );
          })}
        </div>

        {/* The works-per-decade graph; the hovered era is shaded using the real width
            of its button below (measured in px), so the highlight aligns exactly.
            Hovering the graph itself highlights the column under the cursor. */}
        <div
          ref={graphRef}
          onMouseMove={handleGraphMove}
          onMouseLeave={clearHighlight}
          className="relative h-40 w-full"
        >
          {box && (
            <div
              className="pointer-events-none absolute top-0 h-full rounded bg-[var(--color-accent)]/10"
              style={{ left: `${box.left}px`, width: `${box.width}px` }}
            />
          )}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-full w-full overflow-visible"
          >
            <polygon points={areaPts} fill="var(--color-accent)" opacity={0.12} />
            <polyline
              points={linePts.join(' ')}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            {counts.map((c) => (
              <circle
                key={c.decade}
                cx={xOf(c.decade + 5)}
                cy={yOf(c.count)}
                r={2.5}
                fill="var(--color-accent)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        </div>
      </div>

      {/* ---- Bottom half: hoverable / clickable era-group band ----
           EQUAL-WIDTH segments (deliberately NOT year-proportional): recent history
           packs many short periods, so proportional widths cram their titles
           unreadably. Each period gets the same slice and its label wraps fully — and
           the graph above shares this same equal-slot scale, so each era's curve sits
           directly over its button. The exact years aren't lost: every segment prints
           its own year range, and time still flows left→right within each slot. */}
      <div className="flex w-full divide-x divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)]">
        {groups.map((g, i) => {
          const n = itemsInGroup(ds.items, g).length;
          const active = hovered === i;
          return (
            <button
              key={i}
              ref={(el) => {
                bandBtns.current[i] = el;
              }}
              onClick={() => onSelect(g)}
              onMouseEnter={() => highlight(i)}
              onMouseLeave={clearHighlight}
              className={`flex min-h-[4.5rem] flex-1 basis-0 flex-col items-center justify-center gap-0.5 px-2 py-2 text-center transition-colors ${
                active
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'bg-[var(--color-card)] text-[var(--color-ink)] hover:bg-[var(--color-wall-soft)]'
              }`}
            >
              <span className="serif text-sm leading-tight">{g.label}</span>
              <span className={`text-xs ${active ? 'text-white/80' : 'text-[var(--color-muted)]'}`}>
                {g.start}–{g.end} · {n}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-center text-xs text-[var(--color-muted)]">
        Click a period to browse, rank, and see the leaderboard for that slice.
      </p>
    </div>
  );
}

// Lets you (re)generate AI era-periods. Prominent when none exist yet (the century
// fallback is showing); a quiet "regenerate" once a dataset has its own.
function GenerateBar({
  hasAiGroups,
  busy,
  progress,
  onGenerate,
}: {
  hasAiGroups: boolean;
  busy: boolean;
  progress: string;
  onGenerate: () => void;
}) {
  if (busy) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 text-sm">
        <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
        <span className="text-[var(--color-muted)]">{progress || 'Proposing periods…'}</span>
      </div>
    );
  }
  if (hasAiGroups) {
    return (
      <div className="flex justify-end">
        <button
          onClick={onGenerate}
          className="text-xs text-[var(--color-muted)] underline hover:text-[var(--color-accent)]"
        >
          Regenerate periods
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] px-4 py-3">
      <p className="text-sm text-[var(--color-muted)]">
        Showing century buckets. Generate the field's own named periods for a sharper timeline.
      </p>
      <button
        onClick={onGenerate}
        className="rounded-full bg-[var(--color-accent)] px-4 py-2 text-sm text-white"
      >
        Generate periods
      </button>
    </div>
  );
}
