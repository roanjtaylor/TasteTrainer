# TasteTrainer

A personal, local-first "bicycle for the mind": deliberately expose yourself to the best work in a field, and train your eye by browsing it.

Built from the core idea in [`stevejobs.md`](./stevejobs.md) — that doc is the canonical spec; this app executes it.

## What it does

The physical and digital worlds are open — researched, public-domain knowledge. Only the **personal** world sits behind a **sign-in** (Supabase Auth), since that's where your own private uploads live. See [Signing in](#signing-in).

Every dataset belongs to one of three **worlds**, chosen on the landing screen:

- **Physical** — work you can stand in front of or hold: watches, cars, chairs, paintings, buildings.
- **Digital** — work that lives on a screen: websites, apps, product UI, graphics.
- **Personal** — what's *yours*: books, films, music, family memories. The first two worlds are objective (the best of what exists, researched by Claude); this one is subjective and **built by hand** — name a collection, then add items or drop in a batch of your own image files. Uploaded files live in a **private** bucket and are only ever served as expiring signed links. Once built, a personal dataset is browsed and filtered exactly like the others — and, since it holds your own private material, it's the one world that requires signing in.

(This split was previously called "hardware vs software", which mis-described half of what it held — a painting is not hardware. Renamed 2026-07-28.)

Then (steps 0–1 are the researched worlds; the personal world skips straight to building and browsing):

0. **Check this world** — before building anything, audit the shelf itself: Claude reads every field you have in a world and reports how that world really divides, which fields you have no dataset for, which boundaries are drawn wrong (merge/split/rename), and which fields are thin. Each missing field starts a dataset in one click. This is the level above "what's missing?", and it exists because a map built one topic at a time inherits the blind spots you had when you named the topics.
0b. **The map** — that review also draws the world, and the world's shelf *is* that map. Fields sit in named regions on two meaningful axes (for objects, roughly *held → inhabited* across and *practical → expressive* up), sized by how deep they are, and fields you don't have yet appear as **dashed holes** where they belong. Drag cards anywhere and they stay put; **Tidy up** re-flows them. The map is stored, not regenerated — re-reviewing places new fields and proposes changes you accept, so it stays something you can learn rather than something that rearranges itself.
1. **Curate** — name a field; Claude maps both of its axes (subtopics *and* named era-periods), then researches the defining work against an explicit per-era quota so the set can't cluster in one era, countering popularity bias. You review and edit before saving.
2. **Browse** — explore a dataset as a gallery, filtered by one subtopic **or** one era-period. Ask "what's missing?" for the item-level coverage sweep.

Datasets live in Supabase. Images are stored as **URLs only**, never downloaded — except files you upload into the personal world, which have no public URL to point at.

## Stack

TypeScript everywhere. **Frontend:** React + Vite + Tailwind v4. **Backend:** Node + Express (run with `tsx`). Shared types in [`/shared`](./shared).

```
shared/    shared TypeScript types (the data model)
server/    Express API: storage, Claude curation, image sourcing
web/       React app: domain gate, shelf, field map, Curate flow, Dataset view
supabase/  SQL migrations — run these once each in the Supabase SQL editor
stevejobs.md the core idea this app is built from
```

## Prerequisites

- **Node 20+** (Node 22 recommended — global `fetch` is used).
- **Claude access.** The backend calls Claude through a **self-hosted Hugging Face Space proxy** (`HF_BASE_URL`, authenticated with `HF_APP_SECRET`), which uses the owner's Claude subscription rather than metered API credits. The Space streams SSE deltas; `server/src/services/claude.ts` accumulates them and extracts the JSON. `CLAUDE_MODEL` overrides the model.
  - This replaced an earlier Claude Agent SDK integration, which required a login on the machine running the server — workable locally, not once the app was deployed to Render.
  - No key is hardcoded anywhere.

## Signing in

Only the personal world needs it. Every request that touches personal-world content (its datasets, its file uploads) is rejected without a valid Supabase access token — the server checks it, not just the browser (`server/src/auth.ts`). The physical and digital worlds never ask.

- **Web** needs the Supabase project's *publishable* key: `VITE_SUPABASE_KEY` in `web/.env.local` locally and in the Vercel project's env (template: `web/.env.example`). It's a public value. Without it, the personal world shows a "sign-in isn't configured" message; everything else still works.
- **Server** takes `ALLOWED_EMAILS` (comma-separated). The Supabase project is shared with other personal projects, and anyone can create an account in a Supabase project — so "signed in" isn't "is me". This list is what makes the personal world yours alone; the server warns at startup if it's empty.
- **First time:** open the personal world and use "Create your account" on the sign-in screen with an allowlisted email.

## Run it

```bash
npm install        # installs root + server + web (npm workspaces)
npm run dev        # starts the API (:5174) and the web app (:5173) together
```

Then open **http://localhost:5173**. The web app proxies `/api` to the backend automatically.

To run the pieces separately:

```bash
npm run dev -w server
npm run dev -w web
```

## Tuning curation

The AI's curation behaviour is **not a blackbox** — it lives in one editable file:

```
server/src/prompts/curation-rules.md
```

Edit it to refine coverage, anti-bias, dedup, field-filling, or web-search policy. Changes take effect on the next call (the file is re-read each time) — no restart, no code change.

## Database migrations

SQL lives in [`supabase/migrations`](./supabase/migrations); run each once in the Supabase SQL editor. They are idempotent, so re-running is safe.

- `001_create_tables.sql` — the original datasets table.
- `002_physical_digital_and_rankings.sql` — renames stored domains to physical/digital and adds a summary **view** the app reads instead of whole rows. (Also created a `taste_rankings` table for a since-removed ranking feature — harmless to leave in place.)
- `003_world_maps.sql` — adds `taste_world_maps`, one row per world, holding its map (axes, regions, where every field and every proposed field sits). Until it's applied the shelf simply shows the grid and the review names the file.
- `004_jobs.sql` — durable rows for long curation calls, so research survives a closed tab.
- `005_personal_world.sql` — teaches the shelf view the `personal` world. Until it's applied, personal datasets are listed on the *physical* shelf instead of their own.

**002 and 007 are required.** 007 turns the shelf's summary fields into generated columns on `taste_datasets` itself (007 dropped the `taste_dataset_summaries` view 002 introduced); the pre-002 whole-row fallback has been removed, so a missing column now surfaces as a real error rather than silently degrading. Stored domain values are still normalised on read, so rows written before the rename keep working.

## Speed and database usage

The app is read-heavy over data that barely changes, so caching is layered rather than added in one place:

- **Summary columns** — the shelf reads generated columns on `taste_datasets` (topic, description, two counts, derived from `data` at write time) instead of downloading every dataset's full item list to count it in JS. This was the single largest source of egress.
- **Server memory cache** (`server/src/cache.ts`) — a warm server answers repeat reads without touching Supabase at all, and de-duplicates concurrent misses into one query. Writes invalidate explicitly.
- **HTTP caching** — GET responses carry `Cache-Control` plus an ETag, so a revalidation that finds nothing changed costs an empty 304 instead of the payload. Error responses are always `no-store`.
- **gzip** — on by default for API responses (SSE excluded so live curation progress isn't buffered).
- **Client cache** (`web/src/lib/store.ts`) — stale-while-revalidate over localStorage: a screen you've seen paints instantly from the last known value and corrects itself in the background. Shelf cards prefetch their dataset on hover, so the click usually lands on an already-loaded screen.
- **Immutable images** — stored screenshots are content-hashed, so they're uploaded with a one-year cache lifetime instead of Supabase Storage's one-hour default.

## Notes / known edges

- The physical world's image **swap picker** scrapes an unofficial DuckDuckGo endpoint (chosen for cleaner results, no API key), falling back to the official Wikimedia Commons search API when that scrape breaks. If both come back empty, paste an image URL directly.
- Digital-world screenshots are rendered by **our own headless Chromium** against the Wayback Machine, with every non-`archive.org` request blocked so an archived page can't re-hydrate from the live web. When no usable snapshot exists it falls back to a screenshot of the **live site** — which is not the design of that year, so the item is badged **not period-accurate** in the review grid and the gallery rather than passing silently. Swap the image to pick a nearer snapshot.
- Personal uploads are **images only** for now (JPEG, PNG, WebP, GIF, AVIF; 25 MB each) — an item is shown by an `<img>`. A book, film or album is represented by its cover (upload it, paste a URL, or use the image search), with an optional link to where it lives.
- UI is intentionally a **simple MVP** in the gallery aesthetic (warm beige, pill nav).
