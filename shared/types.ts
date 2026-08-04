// Shared data model for TasteTrainer.
// Canonical shape decided in /plan/2-data.md. Both the server and the web app
// import these types so the catalogue shape stays in sync everywhere.

/**
 * Which world a dataset belongs to (7-software-design.md). A dataset is wholly one
 * domain or the other — it's a property of the macro topic, not of individual items.
 *
 * Named for the WORLD the work exists in, not the medium it's built with: a painting
 * is not "hardware" and a motion graphic is not "software", but both sit cleanly on
 * the physical/digital line. Renamed from 'hardware'|'software' on 2026-07-28.
 */
export type Domain = 'physical' | 'digital';

/** The pre-rename values, still present in rows written before 2026-07-28. */
const LEGACY_DOMAINS: Record<string, Domain> = { hardware: 'physical', software: 'digital' };

/**
 * Coerce anything stored or sent over the wire into a valid Domain. Accepts the
 * legacy 'hardware'/'software' spellings so old rows and any stale client keep
 * working, and falls back to 'physical' — the only world that existed before the
 * split, so an absent value can only have meant that.
 */
export function normalizeDomain(raw: unknown): Domain {
  const value = String(raw ?? '').toLowerCase();
  if (value === 'physical' || value === 'digital') return value;
  return LEGACY_DOMAINS[value] ?? 'physical';
}

/** Same as normalizeDomain, but keeps "no domain given" distinct from "physical". */
export function optionalDomain(raw: unknown): Domain | undefined {
  const value = String(raw ?? '').toLowerCase();
  if (!value) return undefined;
  if (value === 'physical' || value === 'digital') return value;
  return LEGACY_DOMAINS[value];
}

/** The one place each world's user-facing wording lives. */
export const DOMAIN_LABELS: Record<Domain, { title: string; short: string; tagline: string }> = {
  physical: {
    title: 'Physical world',
    short: 'Physical',
    tagline: 'Things you can touch — watches, cars, chairs, paintings, buildings.',
  },
  digital: {
    title: 'Digital world',
    short: 'Digital',
    tagline: 'Things on a screen — websites, apps, product UI, graphics.',
  },
};

/**
 * A dataset's URL-safe name — its address in both the app (/physical/ships) and the
 * database (taste_datasets.slug, UNIQUE). Derived from the topic rather than stored
 * separately so the two can never drift: rename the topic and the address follows.
 *
 * Shared because the server writes this value and the web app builds links from it;
 * two copies of the rule would eventually disagree and 404.
 */
export function slugifyTopic(topic: string): string {
  return topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** One canonical category within a macro topic (e.g. Watches -> "Mechanical Watches"). */
export interface Subtopic {
  name: string;
  /** A short mini-definition that guides both the AI's sorting and your eye. */
  description: string;
}

/**
 * A named period grouping the dataset's time axis (e.g. "Renaissance", 1400–1600).
 * AI-initialised per dataset like subtopics, but for ERA. Era is still derived from
 * each item's `year`; era-groups are just a meaningful grouping of that axis (2-data.md).
 * Ranges are contiguous and non-overlapping; `start` is inclusive, `end` exclusive.
 */
export interface EraGroup {
  /** Period name, e.g. "Baroque & Rococo" or "Mid-century". */
  label: string;
  /** Inclusive start year. */
  start: number;
  /** Exclusive end year. */
  end: number;
}

/**
 * How a digital item's screenshot was actually obtained (7-software-design.md).
 *
 * Recorded because the two outcomes look identical once saved: a true archived
 * render of the 2004 design and a screenshot of today's live site are both just a
 * PNG url in `image`. Without this, an item labelled 2004 wearing a 2026 screenshot
 * saves clean and stays wrong forever — the silent failure the plan doc flagged and
 * nothing in the app could see. `year` is the year actually captured, which is the
 * closest snapshot found, not necessarily the item's `year`.
 */
export interface Capture {
  kind: 'archived' | 'live';
  year?: number;
}

/**
 * True when a capture can't be showing the design of `year` — a live screenshot
 * standing in for a past year, or an archived snapshot that landed more than a
 * couple of years off. Shared so the review grid and the browse view agree.
 */
export function isPeriodAccurate(capture: Capture | undefined, year: number | null): boolean {
  if (!capture || year == null) return true;
  const currentYear = new Date().getFullYear();
  if (capture.kind === 'live') return year >= currentYear - 1;
  return capture.year == null || Math.abs(capture.year - year) <= 2;
}

/** A single piece of work in a dataset. */
export interface Item {
  id: string;
  /** What it is, e.g. "Eames Lounge Chair". */
  name: string;
  /** Short note on why it's considered great (looking -> perceiving). */
  description: string;
  /** Web address of the picture. URL only — never downloaded (2-data.md #3). */
  image: string;
  /** Year made/released. Drives the derived era. null if unknown. */
  year: number | null;
  /** Company / maker, where applicable (e.g. "Patek Philippe"). "" for works with no company. */
  brand: string;
  /** The individual responsible: designer, artist, architect. "" if not applicable. */
  creator: string;
  /** One-sentence fun/notable fact that gives the item soul. */
  definingFact: string;
  /** The one canonical subtopic it belongs to (references a Subtopic.name). */
  subtopic: string;
  /**
   * Canonical site/product address (digital domain only — 7-software-design.md).
   * Drives the screenshot pipeline: `image` is a screenshot of this url, at `year`.
   * "" / absent for physical items.
   */
  url?: string;
  /**
   * How `image` was captured (digital domain only). Absent on physical items and on
   * anything curated before capture reporting existed — treated as "not known", not
   * as "inaccurate".
   */
  capture?: Capture;
  createdAt: string;
}

/** A dataset = a macro topic (the field you're cataloguing). One JSON file per dataset. */
export interface Dataset {
  id: string;
  /** Which world this field belongs to — physical or digital (7-software-design.md). */
  domain: Domain;
  /** The macro topic name, e.g. "Watches". */
  topic: string;
  /** REQUIRED concise capture of the field's core idea (2-data.md #4). */
  description: string;
  /** The canonical, AI-initialised list of subtopics. */
  subtopics: Subtopic[];
  /**
   * Named era-periods grouping the time axis (AI-initialised). Optional: older
   * datasets predate this field, and the web app derives a century-bucket fallback
   * when it's absent (web/src/lib/format.ts: eraGroupsOf).
   */
  eraGroups?: EraGroup[];
  items: Item[];
  createdAt: string;
  updatedAt: string;
}

/** A lightweight summary for the datasets home shelf. */
export interface DatasetSummary {
  id: string;
  domain: Domain;
  topic: string;
  description: string;
  itemCount: number;
  subtopicCount: number;
  updatedAt: string;
}

/** Per-item Elo state within a dataset (5-comparison.md). */
export interface EloEntry {
  itemId: string;
  rating: number;
  wins: number;
  losses: number;
  /** Total comparisons this item has appeared in. */
  games: number;
}

/**
 * Who is doing the ranking. Arcade-cabinet identity: you type a name, that name owns
 * your scores — no account, no password, no login round-trip. `key` is the normalised
 * form used for storage/equality (so "Roan" and "roan " are the same player);
 * `name` is what gets displayed, spelled the way it was first entered.
 */
export interface Ranker {
  key: string;
  name: string;
}

/** Longest name the cabinet accepts. Long enough to be a real name, short enough to fit a row. */
export const RANKER_NAME_MAX = 16;

/** The storage/equality form of a ranker name. Shared so web and server agree exactly. */
export function rankerKeyOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, RANKER_NAME_MAX);
}

/** Trim/collapse a typed name for display. Returns "" when nothing usable was typed. */
export function cleanRankerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, RANKER_NAME_MAX);
}

/** One person's comparison outcomes for one dataset. */
export interface ResultsFile {
  datasetId: string;
  /** Whose ranking this is. Absent on rows written before per-person rankings existed. */
  ranker?: Ranker;
  ratings: Record<string, EloEntry>;
  /** Total comparisons recorded across the whole dataset. */
  comparisons: number;
  updatedAt: string;
}

/** A person who has ranked a dataset — the cabinet's high-score name plate. */
export interface RankerSummary extends Ranker {
  /** How many 1v1 choices this person has made in this dataset. */
  comparisons: number;
  /** How many distinct items they've actually judged. */
  itemsJudged: number;
  updatedAt: string;
}

/** The pseudo-ranker key meaning "everyone's rankings, pooled". */
export const EVERYONE = 'everyone';

/** One row of a leaderboard. `rankerCount` is only set on the pooled view. */
export interface LeaderboardRow {
  item: Item;
  entry: EloEntry;
  /** Pooled view only: how many people have judged this item. */
  rankerCount?: number;
}

// ---- Curation request/response payloads (server <-> web) ----

/** A proposed item from Claude, before the user reviews + saves it. */
export interface ProposedItem {
  name: string;
  description: string;
  year: number | null;
  brand: string;
  creator: string;
  definingFact: string;
  subtopic: string;
  /** Physical domain: likely Wikipedia title, used to fetch the lead image. */
  wikipediaTitle?: string;
  /** Digital domain: canonical site/product url, used by the screenshot pipeline. */
  url?: string;
  /** Resolved image URL (filled by the server's image step). "" => needs image. */
  image: string;
  /** How that image was captured — surfaced in the review grid before you save. */
  capture?: Capture;
}

/** A reported coverage gap from the "what's missing?" sweep. */
export interface CoverageGap {
  /** The axis that is thin/missing, e.g. "brand", "era", "region", "subtopic". */
  axis: string;
  /** Human-readable description of what's under-represented. */
  detail: string;
}

// ---- The field map: one level ABOVE a dataset (8-field-map.md) ----
//
// "What's missing?" audits the inside of one field. This audits the SHELF: given
// every field you've built in a world, what does the world's real map look like,
// which fields are you blind to, and which boundaries are drawn wrong? It exists
// because a map assembled one dataset at a time inherits the blind spots you had
// when you named them — and nothing else in the app ever questions the naming.

/** The compact inventory of one dataset handed to the field-map review. Item lists
 *  are deliberately NOT sent: this call reasons about the shape of the map, not the
 *  contents of any one field, and a whole shelf of items would swamp the prompt. */
export interface FieldSummary {
  topic: string;
  description: string;
  subtopics: string[];
  itemCount: number;
  /** Earliest–latest year across the field's dated items; null when nothing is dated. */
  yearRange: { min: number; max: number } | null;
}

/** A field of this world you have no dataset for — the unknown-unknowns surface. */
export interface MissingField {
  /** Ready to hand straight to the Curate flow. */
  topic: string;
  description: string;
  /** Why this field matters to someone mapping this world — the teaching part. */
  why: string;
}

/** The kinds of structural fix the review can propose for existing fields. */
export type BoundaryKind = 'merge' | 'split' | 'rename';

/** A proposed structural fix to the fields you already have. */
export interface BoundaryIssue {
  kind: BoundaryKind;
  /** The existing dataset topic(s) this concerns. */
  fields: string[];
  /** The concrete change, e.g. "Split into Road Bicycles and Track Bicycles". */
  proposal: string;
  why: string;
}

/** An existing field that is thin or skewed — a pointer to run its own gap sweep. */
export interface ThinField {
  topic: string;
  detail: string;
}

/** The whole world-level review. */
export interface FieldMapReview {
  /** One paragraph on how this world actually divides — the shape to build toward. */
  mapSummary: string;
  missingFields: MissingField[];
  boundaryIssues: BoundaryIssue[];
  thinFields: ThinField[];
}

// ---- The world map: the review, made spatial (8-field-map.md) ----
//
// The review above is prose. This turns it into a picture: fields sit inside named
// regions positioned on two meaningful axes, so WHERE a card sits means something,
// and a field you don't have yet is a visible hole rather than a bullet point.
//
// The design turns on one constraint: a model asked to lay out a world twice gives
// two different answers, and a map that rearranges itself can never be learned. So
// the split is deliberate — **Claude decides meaning, code decides pixels**. Claude
// is reliable at "is a watch held or inhabited"; it is not reliable at "x=340".
// Everything below is the semantic half; `web/src/lib/mapLayout.ts` is the pixels.

/**
 * One end-to-end dimension of a world, proposed once and then left alone.
 * e.g. { label: 'Scale', low: 'held in the hand', high: 'inhabited' }.
 */
export interface MapAxis {
  label: string;
  low: string;
  high: string;
}

/** A named area of a world — the thing datasets belong to on the map. */
export interface MapRegion {
  /** Stable slug. Survives a rename of `name`, which placements reference. */
  id: string;
  name: string;
  description: string;
  /** Where this region sits on the world's axes, each 0–1. Semantic, not pixels. */
  x: number;
  y: number;
}

/**
 * Which region a card belongs to. That is the whole of it.
 *
 * It used to also carry a position and a `pinned` flag, from when cards could be
 * dragged. Without dragging the layout is wholly derived — the same map always draws
 * the same way — so storing coordinates would only be a second source of truth for
 * something already computed. Older rows still have those keys; they're ignored.
 */
export interface Placement {
  regionId: string;
}

/** A proposed field, placed on the map as a hole in its region. */
export interface GhostField extends MissingField {
  /** Stable key (the topic slug) — also its key in `placements`. */
  key: string;
  regionId: string;
}

/**
 * A change to the map the review proposes and you accept or dismiss.
 *
 * Only the three kinds that can be applied mechanically and safely live here.
 * Anything bigger — merge two fields, split a dataset's items — stays advice in
 * `boundaryIssues`, because applying it would mean moving items around, and a
 * suggestion is not consent for that.
 */
export type MapSuggestion =
  | { id: string; kind: 'add-region'; why: string; region: MapRegion }
  | { id: string; kind: 'move-field'; why: string; datasetId: string; toRegionId: string }
  | { id: string; kind: 'rename-region'; why: string; regionId: string; name: string };

/** One world's stored map. Durable: generated once, then amended, never redrawn. */
export interface WorldMap {
  domain: Domain;
  axes: { x: MapAxis; y: MapAxis };
  regions: MapRegion[];
  /** Keyed by dataset id, or by a ghost's `key`. */
  placements: Record<string, Placement>;
  ghosts: GhostField[];
  /** Proposed changes awaiting accept/dismiss. */
  suggestions: MapSuggestion[];
  updatedAt: string;
}

/** URL-safe, stable id for a region or ghost. Shared so the server and the map agree. */
export function mapSlug(name: string): string {
  return slugifyTopic(name) || 'unnamed';
}
