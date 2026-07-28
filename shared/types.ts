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
}

/** A reported coverage gap from the "what's missing?" sweep. */
export interface CoverageGap {
  /** The axis that is thin/missing, e.g. "brand", "era", "region", "subtopic". */
  axis: string;
  /** Human-readable description of what's under-represented. */
  detail: string;
}
