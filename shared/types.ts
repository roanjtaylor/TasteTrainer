// Shared data model for TasteTrainer.
// Canonical shape decided in /plan/2-data.md. Both the server and the web app
// import these types so the catalogue shape stays in sync everywhere.

/** One canonical category within a macro topic (e.g. Watches -> "Mechanical Watches"). */
export interface Subtopic {
  name: string;
  /** A short mini-definition that guides both the AI's sorting and your eye. */
  description: string;
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
  createdAt: string;
}

/** A dataset = a macro topic (the field you're cataloguing). One JSON file per dataset. */
export interface Dataset {
  id: string;
  /** The macro topic name, e.g. "Watches". */
  topic: string;
  /** REQUIRED concise capture of the field's core idea (2-data.md #4). */
  description: string;
  /** The canonical, AI-initialised list of subtopics. */
  subtopics: Subtopic[];
  items: Item[];
  createdAt: string;
  updatedAt: string;
}

/** A lightweight summary for the datasets home shelf. */
export interface DatasetSummary {
  id: string;
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

/** Comparison outcomes / rankings for one dataset (data/results/<id>.json). */
export interface ResultsFile {
  datasetId: string;
  ratings: Record<string, EloEntry>;
  /** Total comparisons recorded across the whole dataset. */
  comparisons: number;
  updatedAt: string;
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
  /** Likely Wikipedia title, used to fetch the lead image. */
  wikipediaTitle: string;
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
