# TasteTrainer

A personal, local-first "bicycle for the mind": deliberately expose yourself to the best work in a field, train your eye through forced 1v1 judgement, and build defined taste.

Built from the decision docs in [`/plan`](./plan) — that folder is the canonical spec; this app executes it.

## What it does

Every dataset belongs to one of two **worlds**, chosen on the landing screen:

- **Physical** — work you can stand in front of or hold: watches, cars, chairs, paintings, buildings.
- **Digital** — work that lives on a screen: websites, apps, product UI, graphics.

(This split was previously called "hardware vs software", which mis-described half of what it held — a painting is not hardware. Renamed 2026-07-28; see `plan/7-software-design.md`.)

Then:

1. **Curate** — name a field; Claude maps its subtopics and researches the defining work (countering popularity bias — see `plan/3-curation.md`). You review and edit before saving.
2. **Browse** — explore a dataset as a gallery, filtered by subtopic and/or era. Ask "what's missing?" to find coverage gaps.
3. **Rank** — pick the better of two items (Elo). **Enter a name first, arcade-style** — no account, no password. Your choices are filed under that name, so each person builds their own ranking of the same field.
4. **Leaderboard** — one board per person, plus a pooled **Everyone** view showing where the room agrees. Taste is personal, so a single merged ranking would hide exactly the disagreement worth looking at.

Datasets and rankings live in Supabase. Images are stored as **URLs only**, never downloaded.

## Stack

TypeScript everywhere. **Frontend:** React + Vite + Tailwind v4. **Backend:** Node + Express (run with `tsx`). Shared types in [`/shared`](./shared). See `plan/1-setup.md`.

```
shared/   shared TypeScript types (the data model)
server/   Express API: storage, Claude curation, image sourcing, Elo
web/      React app: Datasets home, Curate flow, Dataset view
data/     legacy local JSON (pre-Supabase); git-ignored
supabase/ SQL migrations — run these once each in the Supabase SQL editor
plan/     the decision docs this app is built from
```

## Prerequisites

- **Node 20+** (Node 22 recommended — global `fetch` is used).
- **Claude credentials.** The backend calls Claude via the **Claude Agent SDK**. It uses whatever credentials your environment already has:
  - If you're logged into Claude Code on this machine, the SDK uses that login.
  - Otherwise set `ANTHROPIC_API_KEY` in your environment before starting the server.
  - No key is hardcoded anywhere. (Note: per Anthropic's terms, the Agent SDK is intended for first-party/personal use with your own credentials — which is exactly this tool's purpose.)

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

Edit it to refine coverage, anti-bias, dedup, field-filling, or web-search policy. Changes take effect on the next call (the file is re-read each time) — no restart, no code change. See `plan/3-curation.md`.

## Database migrations

SQL lives in [`supabase/migrations`](./supabase/migrations); run each once in the Supabase SQL editor. They are idempotent, so re-running is safe.

- `001_create_tables.sql` — the original datasets + results tables.
- `002_physical_digital_and_rankings.sql` — renames stored domains to physical/digital, adds the `taste_rankings` table behind per-person leaderboards, and adds two summary **views** the app reads instead of whole rows.

**002 is required for per-person rankings** (the API returns a clear error naming the file until it's applied). The rest degrades gracefully: domains are also normalised on read, and the shelf falls back to whole-row reads — correct, just slower — if the summary view isn't there yet.

## Speed and database usage

The app is read-heavy over data that barely changes, so caching is layered rather than added in one place:

- **Summary views** — the shelf reads `taste_dataset_summaries` (topic, description, two counts) instead of downloading every dataset's full item list to count it in JS. This was the single largest source of egress.
- **Server memory cache** (`server/src/cache.ts`) — a warm server answers repeat reads without touching Supabase at all, and de-duplicates concurrent misses into one query. Writes invalidate explicitly.
- **HTTP caching** — GET responses carry `Cache-Control` plus an ETag, so a revalidation that finds nothing changed costs an empty 304 instead of the payload. Error responses are always `no-store`.
- **gzip** — on by default for API responses (SSE excluded so live curation progress isn't buffered).
- **Client cache** (`web/src/lib/store.ts`) — stale-while-revalidate over localStorage: a screen you've seen paints instantly from the last known value and corrects itself in the background. Shelf cards prefetch their dataset on hover, so the click usually lands on an already-loaded screen.
- **Immutable images** — stored screenshots are content-hashed, so they're uploaded with a one-year cache lifetime instead of Supabase Storage's one-hour default.

## Notes / known edges

- The image **swap picker** uses an unofficial DuckDuckGo endpoint (chosen for cleaner results, no API key). If it ever stops returning results, paste an image URL directly in the picker — it's a small, contained fix (`plan/4-images.md`).
- A ranker name is an **identity, not a login**: anyone who types your name gets your board. That's the accepted trade for having no accounts at all — the same promise an arcade cabinet makes.
- Existing screenshots uploaded before the cache-lifetime change keep their old one-hour header until they're re-rendered; `scripts/refresh-image-cache.mjs` rewrites them in bulk if that matters.
- UI is intentionally a **simple MVP** in the gallery aesthetic (warm beige, pill nav).
