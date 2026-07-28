# The digital world — a second domain

> **Renamed (2026-07-28).** This doc was written as "Hardware vs Software", and the code
> used `domain: 'hardware' | 'software'`. That naming was wrong on its own terms: a painting
> is not hardware and a motion graphic is not software, yet both sit cleanly on the line
> this split actually draws — *does the work exist in the room with you, or on a screen?*
> The domains are now **`physical`** and **`digital`** everywhere: the `Domain` type, the
> stored dataset rows (`supabase/migrations/002_*.sql`), the landing gate, and the curation
> prompts. Legacy values are still accepted on read, so nothing written before the rename
> breaks. The decisions below stand unchanged — read "hardware" as "physical" and "software"
> as "digital" throughout; the filename is kept so the ~30 code comments citing it stay valid.


> **UI →** the domain split is a screen-map change (owned here, cross-referenced into `6-ui.md`
> when resolved). Feature-specific interaction (the screenshot picker) stays in this doc,
> mirroring how `4-images.md` owns the 3×3 DuckDuckGo picker.

**Purpose**
`4-images.md` deferred this on purpose: *"Domains are physical design + art for the MVP... Website/digital design is deferred until the MVP is proven... will be planned separately later."* The MVP is proven (`f71ad8e` onward: curated, filterable, ranked datasets working end to end). This doc is that separate plan: extend TasteTrainer to train taste in **software/digital design** — websites, apps, product UI — alongside the existing physical-object domain, so the *expose → perceive → internalize → apply* loop (`ethos.md`) works for the craft that actually pays your bills as a founder, not just objects.

**The core decision(s)**
1. **Domain split** — how Hardware and Software divide the app without forking it into two products.
2. **Categorising software** — how a software field gets structured (the "websites vs apps, customer vs enterprise, finance vs general" question).
3. **Sourcing a real image of a digital thing** — the genuinely hard, novel part: screenshots + Wayback Machine.
4. **Curation differences** — what Claude needs to return for a software item vs a hardware one.
5. **What's reused unchanged** — the point of doing this carefully is *not* rebuilding what already works.

---

## 1. Domain split

**The core decision:** is "Hardware vs Software" a property of the *dataset* (macro topic), or does it need its own storage/app split?

**Recommended default: a `domain: 'hardware' | 'software'` tag on the Dataset, treated exactly like a third filterable axis** — not a fork into two apps, two databases, or two codepaths. Concretely:
- `Dataset.domain: 'hardware' | 'software'`. Every dataset is one or the other — a dataset is a macro topic (`2-data.md` §1), and a topic like "Watches" or "SaaS Dashboards" is wholly one domain, so this is a dataset-level field, not a per-item one.
- **Migration:** all existing datasets predate this field and are entirely physical objects → backfill `domain: 'hardware'` for every current row (one Supabase `UPDATE`, mirroring the precedent in `scripts/migrate-to-supabase.mjs`).
- **New dataset creation** (Curate flow, `3-curation.md`) gains one new first choice: which domain. This determines the curation prompt branch (§4) and the image pipeline (§3) used for every item in that dataset — so it's asked once, up front, not per item.
- **Home shelf** (`Home.tsx`) filters to one domain at a time rather than showing every dataset mixed together — a "Watches" card and a "Fintech Dashboards" card next to each other would be a category error, the same reasoning that keeps subtopics canonical per dataset.

**Open question — entry screen vs. nav toggle (your call, this is genuinely subjective):**
- **(a) Dedicated landing screen** — the very first thing you see is "Hardware / Software", *then* the familiar shelf for that domain. Closest to your own wording ("an initial selector"). Gives the split real conceptual weight — you're consciously choosing which taste you're training right now.
- **(b) Persistent pill toggle** in the top nav (reusing the exact pattern already in `Nav.tsx`/the mode switch in `DatasetView.tsx`), remembered in `localStorage`. Lower friction — no extra click on every return visit — and keeps the screen map flat (`6-ui.md` §1 explicitly favours "no deep nesting").
- **My lean:** (b) with a first-run-only prompt — the persistent toggle for every subsequent visit, but the very first time you ever open the app it defaults to asking. Cheap to build, doesn't add a permanent extra step, still gives the "which world am I in" moment once. I'll ask you below rather than assume.

## 2. Categorising software — reuse, don't reinvent

Your instinct ("website vs app; customer vs enterprise; finance vs general") is really describing **subtopics** — and `2-data.md` already has a canonical, AI-initialised subtopic mechanism per dataset. The fix isn't a new taxonomy engine; it's recognising that **each of your example categories is just a dataset (macro topic) or a subtopic within one**, exactly like "Mechanical Watches" vs "Smartwatches" already are within *Watches*.

Concretely, a software domain is a **set of datasets** the same shape as the hardware ones:
- *SaaS Dashboards* — subtopics like Onboarding, Data tables, Settings panels.
- *E-commerce Homepages* — subtopics like Fashion retail, Marketplaces, DTC brands.
- *Social Networks* — subtopics like Profile pages, Feeds, Messaging.
- *Fintech Apps* — subtopics like Consumer banking, Trading, Crypto.
- *Operating System UI* — subtopics like Desktop shells, File managers, Settings.

You decide the split granularity the same way you already do for hardware: start a new dataset when a field is genuinely its own macro topic; let a subtopic handle a finer cut within one. "Customer vs enterprise" becomes either two datasets (if the fields feel genuinely separate, e.g. *Consumer Banking Apps* vs *Enterprise SaaS Dashboards*) or two subtopics inside one (if they belong to the same macro field). **No schema change needed for this part at all** — the existing `subtopics[]` + AI-proposal step (`3-curation.md` step 2) already does the job; the curation-rules prompt just needs a software-aware branch (§4) so Claude's *breadth-before-depth* field-mapping (`3-curation.md`, *Curation quality*) reasons about software axes (interaction pattern, platform, era of design) instead of brands/movements.

`eraGroups` also transfers directly and gets *more* interesting for software: a period like *"Web 2.0 (2004–2009)"* or *"Skeuomorphism (2007–2013)"* or *"Flat design (2013–2019)"* is exactly the shape `EraGroup` already models (`label`, `start`, `end`), and is a genuinely useful lens for digital design that physical objects don't have as cleanly.

## 3. Sourcing a real image — the hard, novel part

This is where `4-images.md` explicitly punted, and it's the one piece that needs real new infrastructure.

**The core problem `4-images.md`'s model doesn't cover:** a physical object has one stable, already-existing photo somewhere (Wikimedia). A **website has no equivalent** — there's no hosted photo of "Stripe's homepage in 2012"; you have to generate that image yourself. That's in tension with the *"link, don't store"* decision (`2-data.md` §3) — unless the generation step itself produces a **URL**, not a downloaded file, which is what makes this workable without touching the Item schema's storage philosophy.

**Recommended pipeline (mirrors the existing two-hop Wikimedia pattern in `services/images.ts` — resolve a title, then resolve a thumbnail URL):**

1. **Resolve which archived version to show.** For anything but a current, still-live design, hit the **Wayback Machine CDX API** (`http://web.archive.org/cdx/search/cdx?url=<domain>&output=json&from=<year>0101&to=<year>1231&limit=1&filter=statuscode:200`) with the item's `url` and target `year`, and get back the closest snapshot's timestamp. Build the archived-page URL: `https://web.archive.org/web/<timestamp>if_/<url>` (the `if_` modifier renders the page standalone, without the Wayback toolbar chrome). For a **present-day** item, skip this hop and use the live URL directly.
2. **Turn that page URL into an image URL.** Rather than self-hosting a headless browser (real cost/ops burden on Render's free tier — cold starts, memory, Chromium binary size), use a **URL-in, image-out screenshot service** so the result is still just a link, same as Wikimedia. **Recommended default: WordPress's `mshots` service** (`https://s.wordpress.com/mshots/v1/<url-encoded-page>?w=1200&h=900`) — free, no API key, no setup, been stable for over a decade — matching the exact bar `4-images.md` set for DuckDuckGo ("no API key or setup"). Feed it either the live URL or the Wayback snapshot URL from step 1 — it screenshots whatever page it's given, archived pages included.
3. **Store the resulting mshots URL as `item.image`.** No schema change — the Item's `image` field is still just a URL, whichever domain the item belongs to.

**Known, accepted risk (flagging honestly, same spirit as the DuckDuckGo call in `4-images.md`):** `mshots` renders **asynchronously** — the first request can return a "generating…" placeholder while the real screenshot renders in the background, ready moments later. Treat this the same way curation's SSE progress already works: show "capturing…" and poll/retry a couple of times before falling through to "needs image" (the same fallback state `Photo.tsx` already renders for any missing image) so a slow render never blocks saving. Cheap to build since the retry/progress pattern already exists in this codebase.

**The alternative picker for software** (replaces the DuckDuckGo 3×3 grid from `4-images.md` — DuckDuckGo image search is useless for "this exact site, this exact year"): a small form — paste a URL, optionally a year — that calls a new `/api/images/screenshot` endpoint and shows **candidate snapshots from nearby timestamps** as the grid of choices, instead of nearby search results. Same interaction shape (3×3 grid, click to pick, or paste a URL), same component (`ImagePicker.tsx`) extended with a software mode rather than a new component.

**Upgrade path, not MVP:** if `mshots` quality/reliability ever isn't good enough, the escape hatch is a paid screenshot API (urlbox.io, screenshotone.com — proper viewport control, full-page capture, retina) swapped in behind the same `screenshotUrl()` function, or self-hosting Playwright (already available in this dev environment) if/when the server's hosting tier can support a headless browser. Neither is needed to start.

## 4. Curation differences

Reuses `3-curation.md`'s whole flow (topic → subtopics → review → save) — the AI connection, the SSE progress pattern, the review-before-save grid, the gap-finder — all domain-agnostic already. Two additions:

- **`curation-rules.md` gets a software-aware branch**, per the file's own design ("if a field ever needs special handling, a section in the same file can branch on it" — `3-curation.md`). For a software dataset, *breadth-before-depth field-mapping* reasons about platform/interaction-pattern/design-era axes instead of brand/movement/region; *anti-popularity bias* still applies (don't just return "the most famous SaaS tools", surface what actually shaped the pattern).
- **Item gains one optional field: `url`** (the canonical site/product address) — used regardless of domain by the screenshot pipeline, empty/unused for hardware items. Claude's `generateItems` call returns `url` instead of `wikipediaTitle` when the dataset's domain is `'software'`; the year field is reframed for software items as *"the year this specific design/snapshot represents"* (which a design can have several of across its life — a redesign is a legitimate reason for the same product to appear as two items, same as e.g. two different-generation cars already can).

No change needed to `Subtopic`, `EraGroup`, `EloEntry`, or the comparison/ranking logic (`5-comparison.md`) — a software item and a hardware item are both just an `Item` with an `image`, competing 1v1 inside their own dataset's scope, exactly as today.

## 5. What's reused unchanged (the payoff of doing this carefully)

- Dataset shape, subtopics, era-groups, and their AI-proposal steps (`2-data.md`, `3-curation.md` step 2).
- The full curate flow: topic → map → research → review grid → save (`3-curation.md`).
- Elo comparison, scoped ranking, leaderboard (`5-comparison.md`) — untouched.
- Filters subpage, fan cards, era timeline (`6-ui.md`) — untouched, just scoped to one domain's datasets at a time.
- `Photo.tsx`'s "needs image" fallback — already the right UI for a screenshot that hasn't resolved yet.
- The "link, don't store" image philosophy (`2-data.md` §3) — preserved because the screenshot service itself returns a URL, not a file.

---

## Resolved (2026-07-04)

1. **Entry point: dedicated landing screen, every session.** Opening the app shows a Hardware/Software choice first, *then* the familiar shelf for that domain — the fuller gate, not a nav toggle. Screen map (`6-ui.md` §1) gains one screen: **Domain select** → Datasets home (filtered to that domain) → everything else unchanged downstream.
2. **Screenshot source: `mshots` (free, zero-setup) to start.** Matches the "no API key or setup" bar every other image source in this app holds to (Wikimedia, DuckDuckGo). The async/best-effort behaviour (§3) is an accepted risk, same posture as the DuckDuckGo call in `4-images.md`. A paid API is the upgrade path only if quality disappoints in practice, not a day-one requirement.
3. **Seed datasets (build these first to prove the domain):** Websites & landing pages, Operating systems & desktop UI, Social networks & consumer apps, SaaS/product dashboards. Deliberately spans very different screenshot shapes — full web pages, desktop chrome, long-lived evolving products, dense data UI — so the pipeline (§3) and the curation-rules software branch (§4) get proven against real variety, not one easy case.

---

## Known issue (2026-07-05): screenshots show the present day, not the archived era

After building §3's `mshots`-over-Wayback pipeline (and a first round of fixes: broader CDX matching, url normalisation, verify-before-return), real usage surfaced that historical items still render as the **live, present-day** design. Two independent causes were stacked here, and it's worth separating them because they need different fixes.

### Cause 1 (already partly addressed): the curation content itself
Nothing forced Claude to actually pick historical years — a generic "cover the field's eras" instruction is easy for a model to quietly default away from toward the present, which it knows most confidently. `curation-rules.md` §f and a per-request `eraSpreadLine()` reinforcement (2026-07-05 build) now push harder on this. **Still not fully load-bearing on its own** — see the structural fix in the plan below.

### Cause 2 (the deeper one): Wayback screenshots of modern sites can render as "current" even when the pipeline "succeeds"
This is the one that actually explains "it looks like the present day," not just "sometimes broken":

- The Wayback Machine archives the **HTML shell** of a page at capture time. A JS-heavy, client-rendered product (a modern React/Vue SPA — which is most of what a "SaaS Dashboards" or "Booking systems" dataset is made of) does much of its actual rendering **after** load, by fetching data/assets over the network. When `mshots` (or any screenshot service) loads an archived replay page, the browser executing that page can still reach out to the **live internet** for anything Wayback didn't intercept — scripts, API calls, CDN assets — and a chunk of that JS will happily fetch **today's** data and re-render the page to look like **today's** site. The archive.org HTML shell loaded; the visual result is still "hydrated" from the live web. This is a well-known, structural limitation of archiving modern web apps, not a bug specific to this codebase — and it's *silent*: the screenshot request "succeeds" (a valid image comes back), so the verify-before-return check added on 2026-07-05 can't catch it, because there's nothing wrong with the HTTP response — the content is just wrong.
- This also explains why it's the **specific products favoured for their long history** (Tesla, Stripe, Dropbox — all JS-heavy modern SPAs) that are most exposed: their older snapshots are exactly the JS-dependent kind most likely to "hydrate live" on replay. Ironically, the *oldest* eras (mid-90s–2000s, mostly static server-rendered HTML) are the **least** affected — those pages had little to no client-side JS to begin with, so there's nothing to reach out live for. The failure gets worse the more recent (and more JS-dependent) the "historical" snapshot is, right up to the present where there's no difference to see at all.

### The fix: control the renderer, don't trust a black box
A third-party screenshot-as-a-service (`mshots`, or any paid equivalent) gives no way to stop a page's JS from phoning home during the shot. The actual fix needs a renderer we control:

**Recommended: self-host a headless-browser render step (Playwright) that blocks all network requests to any host other than `web.archive.org`/`archive.org` while capturing.** Concretely:
1. Navigate to the resolved Wayback snapshot URL.
2. Install a request-blocking rule (Playwright's `page.route()`) that aborts anything not served from an archive.org host — so any script trying to fetch live data or a live CDN asset simply fails, and the page is forced to render from **only** what was actually archived.
3. Screenshot the result. If the page renders (even imperfectly — a period-accurate design, possibly with a few missing assets) that's the honest, correct outcome. If it renders mostly blank because too much was blocked, that's an honest failure — better than a confident, silently-wrong "current" screenshot — and falls through to the existing "needs image" state.
4. Upload the resulting PNG to **Supabase Storage** (already in use for this project) and store *that* public URL as `item.image` — preserving the "link, don't store" philosophy from the item's point of view (it's still just a URL field), even though the bytes now live in our own storage rather than a third party's.

This is a real infrastructure change, not a prompt tweak: it needs Chromium available wherever the server runs (Render supports Docker-based services, so this is buildable, but it's more moving parts than "call a URL"), and a Supabase Storage bucket + public read policy. It replaces `mshots` for the Wayback/historical path specifically; the **live, present-day** path (already just "screenshot the live site") doesn't have this problem and can keep using `mshots` unchanged, or move to the same renderer for consistency.

**Faster, lower-effort alternative if standing up Playwright-on-Render is unwelcome right now:** some paid screenshot APIs (e.g. urlbox.io) support blocking third-party requests/resources as a request parameter, which would fix the same problem without self-hosting a browser — at the cost of a paid key, same "upgrade path" tradeoff flagged in §3 originally, now with a concrete reason to actually take it rather than a hypothetical one.

### Also worth doing regardless of which renderer path is chosen
- **Make the era-spread curation fix (Cause 1) structural, not just a stronger prompt.** Right now era coverage is requested but not guaranteed by construction. A more reliable design: propose the field's named **design eras** (reusing/adapting the existing `eraGroups`/`proposePeriods` mechanism, `2-data.md`) *before* generating items rather than after saving (its current timing), then hand `generateItems` those concrete era buckets and ask it to fill each one explicitly — turning "please spread across eras" into "here are 4 eras, give me items for each," which a model follows far more reliably than an abstract instruction.
- **Surface pipeline outcome as it happens**, reusing the SSE progress channel curation already streams: a line like *"Stripe Dashboard, 2015 → found archived snapshot"* vs *"→ no archived snapshot, used live"* per item, so a real problem is visible in the product itself next time, not diagnosed from symptoms after the fact.
- **Prefer older, simpler (pre-2010-ish) snapshots when a choice exists** between two representative products for an era — static, server-rendered pages of that vintage archive far more faithfully than a JS-heavy one, so this is a free reliability win worth baking into the curation-rules guidance for *which* product to pick per era, not just *which* year.
