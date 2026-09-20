import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { WorldMap } from '../../../shared/types';
import { layoutWorld, type LaidOutCard, type MapCard } from '../lib/mapLayout';

// The world as a map (8-field-map.md).
//
// A grid of cards tells you what you have. This tells you the SHAPE of it: where a
// card sits means something, because the axes mean something, and a field you haven't
// built yet is a dashed hole rather than a line in a report. Zoom out and the faint
// regions are the parts of the world you've never touched.
//
// The map is READ-ONLY. Cards used to be draggable, macOS-desktop style, with the
// positions you chose stored and honoured. That's gone: where a card sits is derived
// entirely from which region it belongs to, so the map says what you and Claude agreed
// and nothing else. Moving a field means changing which region it's in — a statement about
// the world — not nudging a pixel.

export function WorldMapCanvas({ map, cards }: { map: WorldMap; cards: MapCard[] }) {
  const layout = useMemo(() => layoutWorld(map, cards), [map, cards]);

  return (
    <div className="space-y-1.5">
      {/* The canvas. Axis labels sit outside it so nothing overlaps the work. */}
      <div className="flex gap-2">
        <AxisLabel axis={map.axes.y} vertical />
        <div className="min-w-0 flex-1">
          <div
            className="relative w-full overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-wall-soft)]"
            style={{
              // Sized to the window rather than to its own aspect ratio, so the whole
              // map is on screen without scrolling. 80vh is the cap; the calc is what
              // actually binds on a short window. The subtraction is everything stacked
              // around it — nav, the control row, the axis reading, page padding — so
              // adding anything to that column means growing this number too.
              height: 'min(80vh, calc(100vh - 13rem))',
              // Makes 1cqh mean 1% of this box's height, so card text can be sized as a
              // fraction of the card and scale with the map instead of being fixed px.
              containerType: 'size',
            }}
          >
            {/* Tiles, not blobs: they tessellate the canvas, so the map reads as one
                solid shape divided into parts rather than islands floating in space.
                A hairline border is all that separates neighbours — no rounding, no
                gaps, because a gap is exactly what made the old version look scattered. */}
            {layout.regions.map((r) => {
              // A region you've barely built reads faint, so blind spots are visible
              // from across the room rather than needing to be read.
              const filled = r.builtCount / Math.max(1, r.builtCount + r.ghostCount);
              return (
                <div
                  key={r.id}
                  title={r.description}
                  className="pointer-events-none absolute border border-[var(--color-line)]"
                  style={{
                    left: `${r.x * 100}%`,
                    top: `${r.y * 100}%`,
                    width: `${r.width * 100}%`,
                    height: `${r.height * 100}%`,
                    background: `color-mix(in srgb, var(--color-card) ${20 + filled * 70}%, transparent)`,
                  }}
                >
                  <span
                    className="absolute left-3 top-1.5 truncate pr-3 uppercase tracking-wider text-[var(--color-muted)]"
                    style={{ fontSize: 'clamp(8px, 1.7cqh, 13px)' }}
                  >
                    {r.name}
                    {r.ghostCount > 0 && (
                      <span className="ml-1.5 normal-case tracking-normal opacity-70">
                        {r.builtCount}/{r.builtCount + r.ghostCount}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}

            {layout.cards.map((card) => (
              <MapCardView key={card.key} card={card} />
            ))}
          </div>
          <AxisLabel axis={map.axes.x} />
        </div>
      </div>
    </div>
  );
}

function AxisLabel({ axis, vertical }: { axis: WorldMap['axes']['x']; vertical?: boolean }) {
  if (vertical) {
    return (
      <div className="flex w-6 shrink-0 flex-col items-center justify-between py-2 text-[11px] text-[var(--color-muted)]">
        <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{axis.high} ↑</span>
        <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap font-medium">
          {axis.label}
        </span>
        <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{axis.low}</span>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-baseline justify-between px-1 text-[11px] text-[var(--color-muted)]">
      <span>{axis.low}</span>
      <span className="font-medium">{axis.label}</span>
      <span>{axis.high} →</span>
    </div>
  );
}

function MapCardView({ card }: { card: LaidOutCard }) {
  const style: React.CSSProperties = {
    left: `${card.x * 100}%`,
    top: `${card.y * 100}%`,
    width: `${card.width * 100}%`,
    height: `${card.height * 100}%`,
    // Positions are the card's CENTRE.
    transform: 'translate(-50%, -50%)',
    zIndex: card.ghost ? 10 : 20,
    // Text scales with the card, which itself scales to fill the map — so a roomy
    // world reads large and a crowded one stays legible instead of overflowing. The
    // clamp keeps it sane at both extremes.
    fontSize: `clamp(9px, ${(card.height * 100 * 0.4).toFixed(2)}cqh, 22px)`,
  };

  // The name and nothing else. Item counts and descriptions turned a map you read at a
  // glance into a wall of small print — the map's job is to show you where things sit
  // and what isn't there yet; the detail is one click away on the field itself, and
  // still here on hover.
  const shared =
    'absolute flex items-center justify-center overflow-hidden rounded-full px-3 text-center shadow-sm';

  // Ghosts are dashed and muted — a hole in the map, not a thing in it. Clicking one
  // opens the curate flow already filled in from the proposal Claude made.
  return (
    <Link
      to={card.href}
      title={
        card.ghost
          ? `${card.title} — not built yet.${card.why ? ` ${card.why}` : ''}`
          : `${card.title} — ${card.itemCount} items. ${card.subtitle}`
      }
      style={style}
      className={
        card.ghost
          ? `${shared} border border-dashed border-[var(--color-accent)]/60 bg-[var(--color-wall)]/70 text-[var(--color-muted)] hover:bg-[var(--color-card)] hover:text-[var(--color-ink)]`
          : `${shared} border border-[var(--color-line)] bg-[var(--color-card)] hover:border-[var(--color-accent)]`
      }
    >
      <span className="serif truncate leading-none">{card.title}</span>
    </Link>
  );
}

/**
 * The narrow-screen fallback. A 2D canvas is unusable below about 700px, and pretending
 * otherwise would make the map worse than the grid it replaced — so the map degrades
 * into its own regions as sections, which is the same information without the geometry.
 */
export function WorldMapSections({ map, cards }: { map: WorldMap; cards: MapCard[] }) {
  const byRegion = new Map(map.regions.map((r) => [r.id, [] as MapCard[]]));
  for (const card of cards) {
    const regionId = map.placements[card.key]?.regionId ?? map.regions[0]?.id;
    if (regionId) byRegion.get(regionId)?.push(card);
  }

  return (
    <div className="space-y-8">
      {map.regions.map((region) => {
        const members = byRegion.get(region.id) ?? [];
        if (!members.length) return null;
        return (
          <section key={region.id}>
            <h2 className="serif text-2xl">{region.name}</h2>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">{region.description}</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {members
                .slice()
                .sort((a, b) => Number(a.ghost) - Number(b.ghost) || b.itemCount - a.itemCount)
                .map((card) => (
                  <Link
                    key={card.key}
                    to={card.href}
                    className={`rounded-xl p-4 ${
                      card.ghost
                        ? 'border border-dashed border-[var(--color-accent)]/50'
                        : 'border border-[var(--color-line)] bg-[var(--color-card)]'
                    }`}
                  >
                    <div className="serif text-lg leading-tight">{card.title}</div>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">{card.subtitle}</p>
                    <p className="mt-2 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                      {card.ghost ? 'not built yet' : `${card.itemCount} items`}
                    </p>
                  </Link>
                ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
