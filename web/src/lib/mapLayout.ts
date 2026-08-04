// Turning a world's meaning into pixels (8-field-map.md).
//
// Claude decides what the world's axes are, which regions exist, where each region
// sits on those axes, and which region a field belongs to. It decides none of the
// geometry — models are reliable about "is a watch held or inhabited" and unreliable
// about "x=340, y=112", and a map whose cards land in a different arrangement every
// visit is not a map you can learn.
//
// So this module is the other half of that split, and it has three rules.
//
// 1. **The same input always produces the same output.** No Math.random, no Date, no
//    iteration order that depends on object key insertion. Reload and the map is
//    card-for-card identical; that stability is the point of it being spatial at all.
//
// 2. **Regions tile the canvas.** They are not blobs drawn around wherever cards
//    happened to land — that sprawled, overlapped, and left holes. The canvas is
//    *partitioned* into a rectangle per region, so no two can overlap and there is no
//    space between them, by construction rather than by tuning.
//
// 3. **Cards never overlap, and never leave their region.** Inside a tile they flow
//    like words in a paragraph, which is collision-free by construction — there is no
//    relaxation pass, and no way for a card to be anywhere else, now that the map is
//    read-only and cards can't be dragged.
import type { GhostField, MapRegion, WorldMap } from '../../../shared/types';

/** Anything that can sit on the canvas: a built field, or a proposed one. */
export interface MapCard {
  /** Dataset id, or a ghost's key. Also its key in `WorldMap.placements`. */
  key: string;
  title: string;
  subtitle: string;
  /** Not shown on the map — orders placement so bigger fields lead their region. */
  itemCount: number;
  /** Proposed rather than built: drawn as a hole in the map. */
  ghost: boolean;
  /** Where clicking goes — the dataset, or the curate flow prefilled from the ghost. */
  href: string;
  /** Ghosts carry their reason so the card can explain why the gap matters. */
  why?: string;
}

export interface LaidOutCard extends MapCard {
  regionId: string;
  /** Fractions of the canvas, 0–1. Resolution-independent so a resize doesn't move things. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutRegion extends MapRegion {
  /** The region's tile. Tiles tessellate the canvas: no overlap, no gaps. */
  x: number;
  y: number;
  width: number;
  height: number;
  builtCount: number;
  ghostCount: number;
}

export interface MapLayout {
  cards: LaidOutCard[];
  regions: LaidOutRegion[];
}

// A card is a label, not a panel: one line, the field's name, nothing else. Width
// follows the length of that name so the map reads as a set of pills rather than a
// grid of equal boxes with truncated text in them.
const CARD_H = 0.05;
const CHAR_W = 0.007;
const CARD_PAD_W = 0.032;
const MIN_CARD_W = 0.07;
const MAX_CARD_W = 0.21;

/** Breathing room kept between cards, so "not overlapping" still looks separated. */
const GUTTER = 0.011;

/**
 * The gap the flow actually leaves — deliberately a shade more than the minimum.
 *
 * Packing rows at exactly `GUTTER` puts every neighbour precisely on the collision
 * threshold, where a rounding error of one ten-thousandth counts as an overlap and the
 * separation pass then fights the flow forever. Leaving a little slack keeps the flow's
 * output unambiguously clear, at a cost of well under a pixel.
 */
const FLOW_GAP = GUTTER * 1.35;

/** Inset inside a region tile, and the strip at its top reserved for the region name. */
const TILE_PAD = 0.012;
const TILE_HEADER = 0.036;

/**
 * The range the card size may be scaled through.
 *
 * The ceiling is above 1 on purpose. Sizes are quoted at a "natural" reading size, but
 * tiles are sized by what they must hold, so at scale 1 a comfortable world leaves most
 * of every tile empty — which read as a map made mostly of blank space. Letting the
 * search grow the cards means they expand until the tightest tile is full, and the map
 * fills the room it has. The floor is where a name stops being readable at any zoom.
 */
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.2;

function clamp(lo: number, n: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Natural width for a title, before any global shrink. */
function naturalWidth(title: string): number {
  return clamp(MIN_CARD_W, CARD_PAD_W + title.length * CHAR_W, MAX_CARD_W);
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Split the canvas into one rectangle per region, leaving no gaps and no overlaps.
 *
 * A spatial k-d partition rather than a plain treemap, because the axes have to
 * survive: a treemap sorted by size would tessellate beautifully and destroy the
 * meaning of position, which is the whole reason the map exists. So each split cuts
 * the *longer* side of the rectangle (which keeps tiles from turning into slivers),
 * and the regions are sorted along that side by their semantic coordinate before
 * being divided — so left still means what the x-axis says it means, and up still
 * means what the y-axis says.
 *
 * Area is proportional to how much each region has to hold, so a region with nine
 * fields gets room for nine and a region with one doesn't sprawl.
 */
function partition(
  items: Array<{ id: string; x: number; y: number; weight: number }>,
  rect: Rect,
  out: Map<string, Rect>,
): void {
  if (items.length === 0) return;
  if (items.length === 1) {
    out.set(items[0].id, rect);
    return;
  }

  const horizontal = rect.w >= rect.h;
  // Sorted by the semantic coordinate along the axis being cut. Screen y grows
  // downward while the y-axis reads bottom-to-top, so that one is inverted.
  const sorted = [...items].sort((a, b) =>
    horizontal ? a.x - b.x || a.id.localeCompare(b.id) : b.y - a.y || a.id.localeCompare(b.id),
  );

  const total = sorted.reduce((sum, i) => sum + i.weight, 0);
  // Cut where the running weight first reaches half, so the two sides are as evenly
  // loaded as the ordering allows. Both sides always get at least one region.
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    acc += sorted[i].weight;
    cut = i + 1;
    if (acc >= total / 2) break;
  }

  const first = sorted.slice(0, cut);
  const second = sorted.slice(cut);
  const share = first.reduce((sum, i) => sum + i.weight, 0) / total;

  if (horizontal) {
    const w = rect.w * share;
    partition(first, { ...rect, w }, out);
    partition(second, { ...rect, x: rect.x + w, w: rect.w - w }, out);
  } else {
    const h = rect.h * share;
    partition(first, { ...rect, h }, out);
    partition(second, { ...rect, y: rect.y + h, h: rect.h - h }, out);
  }
}

/** The usable area inside a tile — its padding and name strip removed. */
function tileInner(tile: Rect): Rect {
  return {
    x: tile.x + TILE_PAD,
    y: tile.y + TILE_HEADER,
    w: Math.max(0.01, tile.w - TILE_PAD * 2),
    h: Math.max(0.01, tile.h - TILE_HEADER - TILE_PAD),
  };
}

/**
 * Flow cards into a tile like words into a paragraph: left to right, wrapping to a new
 * row when the next one won't fit.
 *
 * A flow, not a scatter, because that is what "no blank spaces between them" means at
 * the card level too — rows pack tight, and a tile ends up looking deliberately filled
 * rather than sprinkled. Returns null when they simply don't fit, which is the signal
 * the global scale search uses to try smaller cards.
 */
function flowInto(
  inner: Rect,
  sizes: Array<{ w: number; h: number }>,
): Array<{ x: number; y: number }> | null {
  const rows: Array<{ items: number[]; width: number }> = [];
  let row: number[] = [];
  let rowWidth = 0;

  for (let i = 0; i < sizes.length; i++) {
    const w = sizes[i].w;
    if (w > inner.w) return null; // a single card wider than its tile
    const needed = row.length ? rowWidth + FLOW_GAP + w : w;
    if (needed > inner.w && row.length) {
      rows.push({ items: row, width: rowWidth });
      row = [i];
      rowWidth = w;
    } else {
      row.push(i);
      rowWidth = needed;
    }
  }
  if (row.length) rows.push({ items: row, width: rowWidth });

  const cardH = sizes[0]?.h ?? CARD_H;
  const blockH = rows.length * cardH + (rows.length - 1) * FLOW_GAP;
  if (blockH > inner.h) return null;

  // Centre the block vertically in the tile; rows are centred horizontally so a short
  // last row doesn't leave the tile looking lopsided.
  const top = inner.y + (inner.h - blockH) / 2;
  const out: Array<{ x: number; y: number }> = new Array(sizes.length);
  rows.forEach((r, ri) => {
    let x = inner.x + (inner.w - r.width) / 2;
    const y = top + ri * (cardH + FLOW_GAP) + cardH / 2;
    for (const i of r.items) {
      out[i] = { x: x + sizes[i].w / 2, y };
      x += sizes[i].w + FLOW_GAP;
    }
  });
  return out;
}

/**
 * Lay out one world.
 *
 * Pinned placements are honoured exactly — dragging a card is the user overruling the
 * layout, and an arrangement that quietly undid that would make the map feel like it
 * was fighting you. They are only clamped into their own region's tile, so a card
 * can't sit outside the region it belongs to.
 */
export function layoutWorld(map: WorldMap, cards: MapCard[]): MapLayout {
  const byRegion = new Map<string, MapCard[]>(map.regions.map((r) => [r.id, []]));
  const fallback = map.regions[0]?.id;
  for (const card of cards) {
    const regionId = map.placements[card.key]?.regionId ?? fallback;
    const bucket = regionId && byRegion.get(regionId);
    if (bucket) bucket.push(card);
  }

  const ordered = new Map<string, MapCard[]>(
    map.regions.map((r) => [
      r.id,
      (byRegion.get(r.id) ?? []).slice().sort(
        // Built before proposed, then by depth — a stable, meaningful order that
        // doesn't depend on the order things happened to arrive in.
        (a, b) =>
          Number(a.ghost) - Number(b.ghost) ||
          b.itemCount - a.itemCount ||
          a.title.localeCompare(b.title),
      ),
    ]),
  );

  // Tile weights come from how much each region must hold, at a fixed reference size —
  // so the partition is decided once and doesn't shift as the card scale changes.
  const tiles = new Map<string, Rect>();
  partition(
    map.regions.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      weight:
        (ordered.get(r.id) ?? []).reduce(
          (sum, c) => sum + (naturalWidth(c.title) + GUTTER) * (CARD_H + GUTTER),
          0,
        ) +
        // A floor, so an empty region still gets a visible tile rather than a sliver.
        0.014,
    })),
    { x: 0, y: 0, w: 1, h: 1 },
    tiles,
  );

  // Largest scale at which every region's cards flow inside its tile. Binary search
  // rather than a formula: whether a set of pills fits a rectangle depends on how they
  // wrap, which no closed form predicts. It is what makes the cards both shrink to fit
  // a crowded world and grow to fill a roomy one.
  let lo = MIN_SCALE;
  let hi = MAX_SCALE;
  let best: { scale: number; spots: Map<string, Array<{ x: number; y: number }>> } | null = null;

  const attempt = (scale: number) => {
    const spots = new Map<string, Array<{ x: number; y: number }>>();
    for (const region of map.regions) {
      const members = ordered.get(region.id) ?? [];
      if (!members.length) {
        spots.set(region.id, []);
        continue;
      }
      const tile = tiles.get(region.id);
      if (!tile) return null;
      const placed = flowInto(
        tileInner(tile),
        members.map((c) => ({ w: naturalWidth(c.title) * scale, h: CARD_H * scale })),
      );
      if (!placed) return null;
      spots.set(region.id, placed);
    }
    return spots;
  };

  for (let step = 0; step < 14; step++) {
    const mid = (lo + hi) / 2;
    const spots = attempt(mid);
    if (spots) {
      best = { scale: mid, spots };
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // Nothing fit even at the floor — take the floor anyway and let cards clamp. Better
  // a cramped map than a blank one.
  if (!best) best = { scale: MIN_SCALE, spots: attempt(MIN_SCALE) ?? new Map() };

  const scale = best.scale;
  const cardH = CARD_H * scale;

  const laidOut: LaidOutCard[] = [];
  for (const region of map.regions) {
    const members = ordered.get(region.id) ?? [];
    const tile = tiles.get(region.id);
    if (!tile) continue;
    const inner = tileInner(tile);
    const flowed = best.spots.get(region.id) ?? [];

    // Straight from the flow. Nothing can sit anywhere else, so there is no collision
    // pass any more: the flow's output is inside the tile and non-overlapping by
    // construction, and cards are no longer draggable to somewhere it isn't.
    members.forEach((card, i) => {
      const spot = flowed[i] ?? { x: inner.x + inner.w / 2, y: inner.y + inner.h / 2 };
      laidOut.push({
        ...card,
        regionId: region.id,
        x: spot.x,
        y: spot.y,
        width: naturalWidth(card.title) * scale,
        height: cardH,
      });
    });
  }

  const regions: LaidOutRegion[] = map.regions.map((region) => {
    const tile = tiles.get(region.id) ?? { x: 0, y: 0, w: 0, h: 0 };
    const members = ordered.get(region.id) ?? [];
    return {
      ...region,
      x: tile.x,
      y: tile.y,
      width: tile.w,
      height: tile.h,
      builtCount: members.filter((c) => !c.ghost).length,
      ghostCount: members.filter((c) => c.ghost).length,
    };
  });

  return { cards: laidOut, regions };
}

/** Build the canvas's cards from a world's datasets and the map's proposed gaps. */
export function cardsFor(
  domain: string,
  datasets: Array<{ id: string; topic: string; description: string; itemCount: number }>,
  ghosts: GhostField[],
  slugify: (topic: string) => string,
): MapCard[] {
  return [
    ...datasets.map((d) => ({
      key: d.id,
      title: d.topic,
      subtitle: d.description,
      itemCount: d.itemCount,
      ghost: false,
      href: `/${domain}/${slugify(d.topic)}`,
    })),
    ...ghosts.map((g) => ({
      key: g.key,
      title: g.topic,
      subtitle: g.description,
      itemCount: 0,
      ghost: true,
      why: g.why,
      href: `/${domain}/new?topic=${encodeURIComponent(g.topic)}&description=${encodeURIComponent(g.description)}`,
    })),
  ];
}
