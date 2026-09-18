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
export type Domain = 'physical' | 'digital' | 'personal';

/**
 * Every world, in the order the gate shows them. `personal` (9-personal-and-auth.md) is
 * the subjective third: not "the best work humanity has made" but the work that made
 * YOU — your books, films, music, family memories. Built by hand from your own files
 * rather than researched by Claude, then browsed and ranked exactly like the other two.
 */
export const DOMAINS: readonly Domain[] = ['physical', 'digital', 'personal'];

function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value);
}

/** The worlds Claude researches. The personal world is hand-built: nothing in it is
 *  knowable from outside your own life, so there is nothing for a model to curate. */
export function isCuratedDomain(domain: Domain): boolean {
  return domain !== 'personal';
}

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
  if (isDomain(value)) return value;
  return LEGACY_DOMAINS[value] ?? 'physical';
}

/** Same as normalizeDomain, but keeps "no domain given" distinct from "physical". */
export function optionalDomain(raw: unknown): Domain | undefined {
  const value = String(raw ?? '').toLowerCase();
  if (!value) return undefined;
  if (isDomain(value)) return value;
  return LEGACY_DOMAINS[value];
}

/** The one place each world's user-facing wording lives. */
export const DOMAIN_LABELS: Record<Domain, { title: string; short: string }> = {
  physical: { title: 'Physical', short: 'Physical' },
  digital: { title: 'Digital', short: 'Digital' },
  personal: { title: 'Personal', short: 'Personal' },
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

/**
 * A dataset's name is a single word by design — "Watches", not "Wrist watches". Claude
 * proposes these (missing-field gaps, boundary-fix renames) and people type them too, so
 * this is the one place both get corrected: whichever word came first wins, silently,
 * rather than failing a save over it.
 */
export function singleWordTopic(topic: string): string {
  return topic.trim().split(/\s+/)[0] ?? '';
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
  /**
   * `archived`/`live` are screenshots of a url at a moment. `reference` is a found
   * depiction of the work — Wikipedia's actual VisiCalc screenshot, a Commons capture
   * of Netscape Navigator 2 — which is how anything that was never a website has to be
   * illustrated. The digital world is not only websites, and the pipeline assumed it
   * was: pre-web items ended up with a screenshot of their own Wikipedia ARTICLE.
   */
  kind: 'archived' | 'live' | 'reference';
  year?: number;
  /** Which resolver produced this image, for provenance in the UI. */
  source?: CandidateSource;
  /** How much the scoring layer trusts it (imageQuality.ts). */
  confidence?: 'high' | 'medium' | 'low';
  /** Short human-readable reason, shown when confidence isn't high. */
  note?: string;
}

/** Every place an item image can come from. Recorded on the item so a picture can
 *  always be traced back to what produced it. */
export type CandidateSource =
  | 'wayback-render'   // our own request-blocking Chromium over a Wayback snapshot
  | 'live-render'      // our own Chromium over the live site
  | 'paid-screenshot'  // urlbox/screenshotone — a scored source, not a last resort
  | 'mshots'           // free third-party screenshotter; unverifiable, hence demoted
  | 'wikipedia'        // article lead image
  | 'commons'          // Wikimedia Commons file
  | 'ia-software'      // Internet Archive software library screenshot
  | 'ddg'              // DuckDuckGo image search
  | 'manual';          // a human pasted or picked it

/**
 * True when a capture can't be showing the design of `year` — a live screenshot
 * standing in for a past year, or an archived snapshot that landed more than a
 * couple of years off. Shared so the review grid and the browse view agree.
 */
export function isPeriodAccurate(capture: Capture | undefined, year: number | null): boolean {
  if (!capture || year == null) return true;
  const currentYear = new Date().getFullYear();
  // A reference image depicts the work itself, so it carries no capture date to be
  // wrong about — a 2011 upload of a 1979 VisiCalc screen is still a 1979 screen.
  if (capture.kind === 'reference') return true;
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
   * How `image` was captured. Absent on anything curated before capture reporting
   * existed (both domains) — treated as "not known", not as "inaccurate".
   */
  capture?: Capture;
  /**
   * Image-sourcing hints, kept so the image can be re-resolved later without asking
   * the model again what kind of thing this is. Digital domain; absent on anything
   * saved before they existed (inferImageKind falls back).
   */
  imageKind?: ImageKind;
  /**
   * A precise, search-engine phrase for finding a picture of THIS SPECIFIC item —
   * not just its name/brand, but the specific model/variant and year, e.g. "Rolex
   * Submariner ref. 5513 1965" rather than "Rolex Submariner". Both domains; absent
   * on anything saved before this field existed.
   */
  imageQuery?: string;
  wikipediaTitle?: string;
  createdAt: string;
}

/** A dataset = a macro topic (the field you're cataloguing). One JSON file per dataset. */
export interface Dataset {
  id: string;
  /** Which world this field belongs to (7-software-design.md, 9-personal-and-auth.md). */
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

// ---- Curation request/response payloads (server <-> web) ----

/**
 * What kind of thing this is, from an IMAGE-SOURCING point of view (digital world).
 *
 * The single most important field for picture quality, because "screenshot this url at
 * this year" is the right strategy for only part of the digital world. An icon set, a
 * typeface, a 1984 desktop, a motion piece and a 1972 terminal form are all digital
 * design and none of them is a web page. Asking the model to say WHICH KIND of thing it
 * proposed is what lets the server pick a resolver that can actually succeed, instead
 * of screenshotting a Wikipedia article and recording it as a live capture.
 */
export type ImageKind =
  /** A website whose past design we want — Wayback snapshot near `year`. */
  | 'archived-site'
  /** A website whose present design we want — capture it live. */
  | 'live-site'
  /** Software UI that isn't a website: OS shells, desktop apps, terminals, pre-web. */
  | 'software-ui'
  /** A graphic artefact: icon set, typeface specimen, poster, logo, motion still. */
  | 'artifact';

/** A proposed item from Claude, before the user reviews + saves it. */
export interface ProposedItem {
  name: string;
  description: string;
  year: number | null;
  brand: string;
  creator: string;
  definingFact: string;
  subtopic: string;
  /**
   * Likely Wikipedia article title. Physical items always have one; digital items now
   * do too, because for anything that was never a website it is the best lead an
   * image resolver can be given.
   */
  wikipediaTitle?: string;
  /** Digital domain: canonical site/product url, used by the screenshot pipeline. */
  url?: string;
  /** Digital domain: which sourcing strategy this item needs. */
  imageKind?: ImageKind;
  /**
   * Both domains: a precise phrase to search image archives with, e.g.
   * "Mac OS System 7 Finder desktop screenshot" or "Rolex Submariner ref. 5513 1965".
   * Written for a search engine, not as a title — the item's own name+brand is often
   * too generic to find the SPECIFIC model/year/version pictured ("Forms", "Search",
   * "Rolex Submariner" alone returns today's current model, not the one being shown).
   */
  imageQuery?: string;
  /** Resolved image URL (filled by the server's image step). "" => needs image. */
  image: string;
  /** How that image was captured — surfaced in the review grid before you save. */
  capture?: Capture;
  /**
   * The other images the cascade found and scored, best first. Populated when the
   * chosen one isn't high-confidence, so the review grid can offer a one-click swap
   * rather than sending you back to the picker.
   */
  candidates?: ImageCandidate[];
}

/** One scored image the cascade found for an item. */
export interface ImageCandidate {
  url: string;
  source: CandidateSource;
  confidence: 'high' | 'medium' | 'low';
  /** Year this image represents, when the source knows it. */
  year?: number;
  width?: number;
  height?: number;
  /** Why it scored as it did — shown under the thumbnail in the picker. */
  note?: string;
}

/** A reported coverage gap from the "what's missing?" sweep. */
export interface CoverageGap {
  /** The axis that is thin/missing, e.g. "brand", "era", "region", "subtopic". */
  axis: string;
  /** Human-readable description of what's under-represented. */
  detail: string;
}

/**
 * How an expansion reads the user's words. 'gaps' follows a sweep: the reported gaps
 * are the brief, and the user's text is a steer weighed against the curation rules.
 * 'direct' is the freeform review mode: no sweep, and the user's text IS the brief.
 */
export type FillMode = 'gaps' | 'direct';

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

/**
 * Applying an accepted `BoundaryIssue`: Claude works out the concrete result (which
 * fields end up with what shape, and where each item lands) and the server carries
 * it out — updating, creating and deleting datasets as the fix requires.
 */
export interface BoundaryFixResult {
  /** Every dataset left standing once the fix is applied, in its final shape. */
  updated: Dataset[];
  /** Topics of datasets that were fully absorbed elsewhere and removed. */
  deletedTopics: string[];
  /** One sentence from Claude on what it did. */
  note: string;
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
  /** The prose half of the last review that drew or amended this map — durable, so
   *  reopening the review page shows the full analysis rather than just the map's
   *  mechanical leftovers (ghosts, suggestions). Overwritten by the next review. */
  lastReview?: FieldMapReview;
  updatedAt: string;
}

/** URL-safe, stable id for a region or ghost. Shared so the server and the map agree. */
export function mapSlug(name: string): string {
  return slugifyTopic(name) || 'unnamed';
}

// ---- Public embed (iframe widget) ----
//
// A stripped-down, unauthenticated view of a dataset for embedding elsewhere as an
// iframe — a shuffleable picture viewer. Deliberately thin: only what the widget
// draws, never the curation-side fields (capture, candidates, etc.), so a site
// embedding it can't scrape more than the picture + caption it shows.

/** One picture in an embed widget. */
export interface EmbedItem {
  id: string;
  name: string;
  image: string;
  year: number | null;
  brand: string;
}

/** What GET /api/embed/:id returns. Never issued for the personal domain — the
 *  server 404s that id rather than saying "this one's private" (9-personal-and-auth.md:
 *  no confirming even the existence of a personal dataset to an unauthenticated caller). */
export interface EmbedDataset {
  id: string;
  topic: string;
  description: string;
  items: EmbedItem[];
}

// ---- Background jobs ----
//
// A curation call that streams its progress and result over SSE (server/src/routes/
// curation.ts) is durably tracked here too, alongside the live stream — the server is
// a persistent process (render.yaml), so the call itself keeps running after the
// browser disconnects; a job row is what lets its result survive to be reviewed in a
// later session instead of only ever reaching a browser that's still connected.

/** Which curation call a job wraps. Only calls that return a proposal for the user to
 *  review (rather than writing straight to storage themselves, like the field-map
 *  review or a boundary fix) need this. */
export type JobKind = 'subtopics' | 'items' | 'gap-fill' | 'gaps';

export type JobStatus = 'running' | 'done' | 'error';

export interface Job {
  id: string;
  domain: Domain;
  kind: JobKind;
  status: JobStatus;
  /** Shown in the resume banner, e.g. "Expand Watches dataset". */
  title: string;
  /** The exact request body the call was started with — enough to resume the screen
   *  it belongs to (and, for a gap-fill job, to re-derive which dataset it targets:
   *  there is no stored dataset id, see `slugifyTopic` on `input.topic`). */
  input: unknown;
  /** The latest progress line — the same text the live SSE stream shows. */
  progress: string;
  /** The call's `done` payload, once `status` is 'done'. */
  result: unknown | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---- The brain: how this app prompts Claude, as data ----
// Served by GET /api/brain and drawn by the settings cog (web/components/BrainPanel.tsx).
// The point is legibility: every Claude call the app makes, what goes into it, what
// comes back, and what the code checks afterwards — so the setup can be read from the
// top down, and a change to it can be judged against what it was before.

/** One Claude call the app makes. The catalogue lives beside the code that makes the
 *  calls (server/src/services/brain.ts), and `runJson` refuses a call that isn't in
 *  it, so this list cannot silently fall behind the prompts. */
export type BrainCallId =
  | 'subtopics'
  | 'periods'
  | 'items'
  | 'gaps'
  | 'gap-fill'
  | 'direct-request'
  | 'field-map'
  | 'boundary-shape'
  | 'boundary-classify';

/** The most recent real run of a call, held in server memory only — it resets when
 *  the server restarts, and says so in the UI rather than pretending to be history. */
export interface BrainRun {
  at: string;
  durationMs: number;
  ok: boolean;
  error: string | null;
  /** True when Claude's first answer wasn't valid JSON and the call was re-asked. */
  retried: boolean;
  systemChars: number;
  promptChars: number;
  /** The exact task prompt that was sent (the system prompt is the rulebook, shown
   *  separately). */
  prompt: string;
}

export interface BrainCall {
  id: BrainCallId;
  name: string;
  /** Which level of the product the call works at. */
  level: 'field' | 'world';
  /** Where in the UI it's fired from. */
  trigger: string;
  /** What the call is for, in one or two sentences. */
  purpose: string;
  /** What the prompt is assembled from. */
  inputs: string[];
  /** The JSON shape asked for. */
  output: string;
  /** Sections of the rulebook this call leans on most (it is sent all of them). */
  rules: string[];
  /** What the code enforces around the model's answer, rather than trusting it. */
  guardrails: string[];
  /** Whether the result survives the browser closing (a durable `Job`). */
  durable: boolean;
  lastRun: BrainRun | null;
}

export interface BrainSetup {
  model: string;
  timeoutMs: number;
  /** Whether this server has the proxy secret — without it every call below fails. */
  proxyConfigured: boolean;
  /** How every call's system prompt is assembled. */
  systemTemplate: string;
  /** The editable rulebook, verbatim (server/src/prompts/curation-rules.md). */
  rules: string;
  rulesPath: string;
  calls: BrainCall[];
  /** When this server process started — the horizon of every `lastRun`. */
  serverStartedAt: string;
}
