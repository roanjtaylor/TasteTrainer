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

/**
 * One post in a saved thread (personal world — server/src/services/tweets.ts).
 *
 * The text is stored, not just the link: a few hundred characters per tweet is nothing,
 * and it is what makes the collection searchable, sortable, and still readable after
 * the original is deleted. Media is the opposite — hotlinked, never copied.
 */
export interface Tweet {
  /** The status id. "" for a tweet pasted in by hand before an import could name it —
   *  the importer matches those by text and fills the id in (mergeLikes). */
  id: string;
  text: string;
  /** Screen name, no "@". */
  author: string;
  authorName: string;
  /** The author's profile picture — hotlinked from X like all media, never copied. */
  avatar?: string;
  /** ISO timestamp; "" when unknown (a deleted tweet known only from the archive). */
  createdAt: string;
  /** One you actually liked, as opposed to one pulled in to complete its thread. */
  liked: boolean;
  /** Somebody else's tweet that the thread is replying to — shown for context only. */
  context?: boolean;
  /** Hotlinked picture urls (a video contributes its poster frame). */
  media?: string[];
}

/** A thread, oldest first: the optional context tweet, then the author's own chain. */
export interface TweetThread {
  tweets: Tweet[];
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
  /** Year made/released. null if unknown. */
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
  /**
   * Personal world: this item IS a saved thread. `name`/`description`/`creator`/`year`/
   * `url` are derived from it on import so browse, filter and rank work unchanged; the
   * card draws the thread itself instead of a picture (components/TweetCard.tsx).
   */
  tweet?: TweetThread;
  createdAt: string;
}

/** A like as the X data archive lists it (data/like.js) — or a bare id from a pasted
 *  link, in which case there is no text to fall back on if the tweet is gone. */
export interface LikedTweetRef {
  id: string;
  text?: string;
}

/** What one import batch did, so the UI can say it rather than just finish. */
export interface TweetImportStats {
  /** New thread items created. */
  added: number;
  /** Likes folded into a thread that was already there. */
  merged: number;
  /** Likes already in the dataset. */
  skipped: number;
  /** Deleted/protected tweets kept from the archive's text alone. */
  unavailable: number;
  /** Couldn't be fetched this time (X rate-limited or errored) — NOT saved, so
   *  importing the same file again retries exactly these. */
  failed: number;
}

/** A dataset =a macro topic (the field you're cataloguing). One JSON file per dataset. */
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
  items: Item[];
  createdAt: string;
  updatedAt: string;
  /** Personal-world only: requires sign-in to view (9-personal-and-auth.md). Absent
   *  or false means public — everything else in `personal` is publicly viewable and
   *  only topics explicitly marked this way sit behind the auth wall. */
  private?: boolean;
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
  private?: boolean;
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

// ---- The world map (8-field-map.md) ----
//
// A picture of a world: fields sit inside named
// regions positioned on two meaningful axes, so WHERE a card sits means something,
// and a field you don't have yet is a visible hole rather than a bullet point.
//
// The design turns on one constraint: a model asked to lay out a world twice gives
// two different answers, and a map that rearranges itself can never be learned. So
// the split is deliberate — **Claude decides meaning, code decides pixels**. Claude
// is reliable at "is a watch held or inhabited"; it is not reliable at "x=340".
// Everything below is the semantic half; `web/src/lib/mapLayout.ts` is the pixels.

/** A field of this world you have no dataset for — the unknown-unknowns surface. */
export interface MissingField {
  /** A single word, ready to become the dataset's name. */
  topic: string;
  description: string;
  /** Why this field matters to someone mapping this world — the teaching part. */
  why: string;
}

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

/** One world's stored map. Durable: drawn once, then amended — and only ever through a
 *  changeset you accepted (chat.ts's `map.*` ops), so it never rearranges itself. */
export interface WorldMap {
  domain: Domain;
  axes: { x: MapAxis; y: MapAxis };
  regions: MapRegion[];
  /** Keyed by dataset id, or by a ghost's `key`. */
  placements: Record<string, Placement>;
  ghosts: GhostField[];
  updatedAt: string;
}

/** URL-safe, stable id for a region or ghost. Shared so the server and the map agree. */
export function mapSlug(name: string): string {
  return slugifyTopic(name) || 'unnamed';
}

// ---- Public embed (iframe widget) ----
//
// A stripped-down view of a dataset for embedding elsewhere as an iframe — a
// shuffleable picture viewer. Thin by choice: only what the widget draws (the
// picture, its caption, and the read-mode "back of the card"), never the
// curation-side fields (capture, candidates, etc.) — it's what the widget needs, not
// a secrecy boundary, since the browser reads the dataset row itself (web/src/lib/db.ts).

/** One picture in an embed widget. */
export interface EmbedItem {
  id: string;
  name: string;
  image: string;
  year: number | null;
  brand: string;
  /** Shown on the card's flipped-over back, not the front — the widget's read mode. */
  description: string;
  definingFact: string;
  /** A saved thread (personal world) — the widget shows the thread instead of a picture. */
  tweet?: TweetThread;
}

/** What the widget browses (web/src/lib/db.ts#getEmbed). A private personal dataset
 *  reads as absent until the viewer signs in, and the widget shows its sign-in form. */
export interface EmbedDataset {
  id: string;
  /** Carried so a report filed from the widget can name the dataset's world. */
  domain: Domain;
  topic: string;
  description: string;
  items: EmbedItem[];
}

// ---- Item reports ----
//
// A viewer flips a picture in the embed widget and, if something's wrong with it,
// leaves a freeform note. Stored durably so it survives the
// anonymous visitor's tab closing, and read by the Claude agent's get_item_reports
// tool so the curator can ask it to act on what was flagged.

export type ItemReportStatus = 'open' | 'resolved';

export interface ItemReport {
  id: string;
  datasetId: string;
  itemId: string;
  /** Denormalized so a reports list reads without a join back to the item, which may
   *  itself have been edited or removed by the time anyone looks. */
  itemName: string;
  domain: Domain;
  text: string;
  status: ItemReportStatus;
  createdAt: string;
}
