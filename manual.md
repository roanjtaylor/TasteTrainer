# TasteTrainer

A personal, local-first "bicycle for the mind": deliberately expose yourself to the best work in a field, and train your eye by browsing it.

Built from the core idea in [`taste.md`](./taste.md) — that doc says what problem this app solves; this manual covers how the current software works.

## What it does

The physical and digital worlds are open — researched, public-domain knowledge. Only the **personal** world sits behind a **sign-in** (Supabase Auth), since that's where your own private uploads live. See [Signing in](#signing-in).

Every dataset belongs to one of three **worlds**, chosen on the landing screen:

- **Physical** — work you can stand in front of or hold: watches, cars, chairs, paintings, buildings.
- **Digital** — work that lives on a screen: websites, apps, product UI, graphics.
- **Personal** — what's *yours*: books, films, music, family memories. The first two worlds are objective (the best of what exists, researched by Claude); this one is subjective and **built by hand** — name a collection, then add items or drop in a batch of your own image files. Uploaded files live in a **private** bucket and are only ever served as expiring signed links. Once built, a personal dataset is browsed and filtered exactly like the others — and, since it holds your own private material, it's the one world that requires signing in.

(This split was previously called "hardware vs software", which mis-described half of what it held — a painting is not hardware. Renamed 2026-07-28.)

Then (steps 0–1 are the researched worlds; the personal world skips straight to building and browsing):

0. **Review the world** — ask Claude in the chat dock (bottom-left) from a world's shelf; "Review this world" is one of the prompts it offers. It reads every field you have, tells you how that world really divides, and **proposes** the changes as a diff you accept or discard: fields you have no dataset for (favouring the ones you wouldn't think of), boundaries drawn wrong (merge / split / rename — staged as create, move items, delete the emptied field), and changes to the map. Nothing is written until you accept, and an accepted changeset can be undone. It exists because a map built one topic at a time inherits the blind spots you had when you named the topics.
0b. **The map** — the world's shelf *is* its map, and Claude draws it ("Draw the map of this world"). Fields sit in named regions on two meaningful axes (for objects, roughly *held → inhabited* across and *practical → expressive* up), sized by how deep they are, and fields you don't have yet appear as **dashed holes** where they belong — click one to ask Claude to build that field. The map is stored, not regenerated: it only changes when you accept map changes Claude proposed (new regions, a field moved, a missing field added), so it stays something you can learn rather than something that rearranges itself.
1. **Build a field** — ask Claude for it, from the map's gaps or in your own words. It works out the subtopics the field divides into, researches the defining work breadth-first — across makers, movements, regions and time — countering popularity bias, sources a picture for each, and stages the whole thing as a diff you accept or discard. Items carry the year they were made; there are no named eras. There is no wizard: the only form left is the personal world's, where the collection is yours to name.
2. **Browse** — explore a dataset as one wall of images, oldest first — no filters; the mosaic itself shows how the field moved. To grow or fix a dataset, **ask Claude** in the chat dock (bottom-left): it sees the dataset and filter on screen, researches, and stages its changes as a diff you accept or discard. "What is this dataset missing?" is one of its presets.

Datasets live in Supabase. Images are stored as **URLs only**, never downloaded — except files you upload into the personal world, which have no public URL to point at.

## Stack

TypeScript everywhere. **Frontend:** React + Vite + Tailwind v4. **Backend:** Node + Express (run with `tsx`). Shared types in [`/shared`](./shared).

```
shared/    shared TypeScript types (the data model)
server/    Express API: storage, the Claude agent + its tools, image sourcing
web/       React app: domain gate, shelf, field map, Dataset view, Claude dock
supabase/  SQL migrations — run these once each in the Supabase SQL editor
taste.md     the problem this app solves (the philosophy behind it)
```

## Prerequisites

- **Node 20+** (Node 22 recommended — global `fetch` is used).
- **Claude access.** The backend calls Claude through a **self-hosted Hugging Face Space proxy** (`HF_BASE_URL`, authenticated with `HF_APP_SECRET`), which uses the owner's Claude subscription rather than metered API credits. The Space runs the Claude Agent SDK and relays tool calls back to the API (`server/src/services/agentRun.ts`). `CLAUDE_MODEL` overrides the model.
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

## The Claude agent (chat dock)

TasteTrainer is three things — **storage**, **display**, and **an approval gate**. Claude does the rest, the way Claude Code works on a folder: say what you want, watch it work, review a red/green diff, accept, keep talking. There are no fixed AI flows (no review buttons, no wizard, no settings cog) and no application logic deciding what Claude may be asked: the product's whole job is to give Claude the context, relay its tools, and gate its writes.

```
Browser ── SSE ──► Render API ── SSE ──► HF Space (Agent SDK, subscription)
 chat dock          owns runs, events,         │
 diff review        changesets, tools          │ tool_request  (down the stream)
                          ▲                    │
                          └────────────────────┘ POST /api/agent/tool-result
```

- **Flow.** The web app sends a message plus the *view context* (world → dataset → item, filters) and the chosen model. The API creates a run, calls the Space's `/api/agent`, stores every event and relays it to the browser. Close the tab and the run carries on; reopen and the transcript replays. A conversation ends only when you close its tab — accepting a diff is a step in it, not the end of it.
- **Saved prompts (`/`).** Type `/` in the dock for the saved prompts — Claude Code's slash commands, for data. Three ship, one per thing you do to data: **`/create`** (find what's missing here and build it — fields and the map for a world, items for a dataset), **`/read`** (teach me about this item / dataset / world, no changes), **`/update`** (bring this dataset up to standard: visitor reports with the scope decided — one item or the whole dataset — then facts, then thin descriptions, then structure; or exactly the pass you name, e.g. "add more detail to every description"). Each is a Markdown file in `server/src/prompts/commands/` (`create.md` → `/create`): a `description:` line in the frontmatter is what the picker shows, the body is what Claude is sent, `$ARGUMENTS` takes whatever you typed after the name. They are prompts and nothing more; the point is a thorough ask on file instead of retyped. The transcript shows the command as typed, with the expanded prompt a click away. Since 2026-09-24 the files are only the defaults: an accepted `prompt.update` changeset (below) stores an override in `taste_prompts`, so a command can be changed, or a new one added, through the chat without a deploy.
- **Questions.** Claude can stop mid-turn and ask you something (`ask_user`): the question appears in the transcript with any options as buttons, the input box becomes the answer box, and the turn resumes when you reply — however long that takes. While it waits it hands back its concurrency slot so other tabs keep moving. The system prompt tells Claude to ask only when the answer changes what it would propose, never for permission (proposing is asking).
- **Tools relay, not HTTP-MCP.** The Space can't reach a localhost API, so each tool call travels as a `tool_request` event on the response stream; the API runs it and answers with a POST to `/api/agent/tool-result`. Works identically locally and deployed, and there is no public tool endpoint to secure. The tool manifest travels with each run, so new tools need no Space deploy.
- **The Space is "simply the connection".** `/api/agent` passes model, effort, maxTurns, timeouts etc. straight through; product limits live in `server/src/config.ts` (`CHAT_MAX_TURNS`, `CHAT_TIMEOUT_MS`). Deliberate exception: host shell/filesystem tools stay off, because the Space's env holds the subscription token and Claude reads untrusted web pages. `/api/chat` on the Space is shared with another app — don't change it.
- **Read tools** (free rein): view, list/get dataset, get item, **query items** (grep for the data — any mix of free text, empty fields, a short-description threshold, subtopic, maker, year range, across one dataset or all, paged), get world map, get curation rules, get commands, get item reports, plus WebSearch/WebFetch on the Space.
- **Propose tools** stage into the run's changeset and never write directly: add / update / remove / move items, update / create / delete dataset (delete: empty datasets only — the last step of a merge), draw map, map changes (regions, placements, proposed missing fields), **resolve reports** (close visitor reports it has dealt with, in the same batch as the fix), **update rules / update command** (find-and-replace edits to the curation rulebook or a saved prompt, or a new prompt; shown as a unified diff and stored as an override in `taste_prompts` on accept — the standard evolves with the conversation, and you approve each edit). Each validates and answers Claude ("staged 9 of 10 — 'X' is not a subtopic; options are …") so it fixes itself in the same run. Merge/split/rename of fields is just create + move + delete staged as one changeset. Whole-dataset passes ("more detail in every description") are ordinary work: read in full, stage updates in batches of 10–15; the system prompt also tells Claude to decide the scope of a report — one item's fault or a pattern across the dataset — before fixing.
- **The gate.** A changeset is an ordered list of ops plus the dataset versions it was built against. Added items show green, removed red and struck through, updated fields old → new. Accept selected / all, or discard — including while Claude is still working, the way you accept one edit in Claude Code before it has made the next (staging and deciding share a per-thread lock, and proposals are validated against the data as saved plus what is still pending, so an accepted op just becomes part of "as saved"; what Claude stages after that opens a fresh changeset under the same turn). Apply re-checks each dataset's `updatedAt`; ops whose base moved are flagged, not overwritten. Every applied changeset can be undone (map ops undo via a whole-map snapshot). This is also the prompt-injection defence: web pages and tweets are untrusted text, and the worst they can do is make Claude *propose* something you then see in red. The map has no write path except an accepted changeset.
- **Decisions.** Personal-world chat is allowed (signed-in only). No separate notes field — `Item.description` is the note. No auto-accept; always review.
- **Queue and stop.** A small in-process limiter (2 concurrent, FIFO) protects the subscription's rate limits; stopping a run aborts the API's fetch, which kills the Space's subprocess. While a run is active the API self-pings to keep Render awake.
- **Not built yet:** no edit-before-accept in the diff (ask Claude to amend, or edit after accepting); vision (checking/choosing images via the Space's `attachments`); queuing a follow-up message while a turn runs (Stop, then send).

Where it lives:

- Space (`craftsmanship/hf-space`): `src/services/agent.ts`, `src/routes/agent.ts`
- API: `services/agentRun.ts` (run engine, short system prompt, the `ask_user` wait), `services/agentTools.ts` (the tools), `services/changesets.ts` (stage / apply / revert), `services/worldMap.ts` (`applyMapOp`), `services/promptStore.ts` (rulebook + saved prompts: shipped files, overridden by `taste_prompts` rows), `services/commands.ts` (`/` expansion), `routes/chat.ts`
- Shared: `shared/chat.ts` — types, and the one reducer both sides fold events with
- Web: `components/chat/*`, `lib/chat.ts`, `lib/chatView.tsx`
- DB: `supabase/migrations/008_chat.sql` (threads, messages, runs, changesets), `012_prompts.sql` (prompt overrides)

## Tuning curation

The AI's curation behaviour is **not a blackbox** — it lives in one editable file:

```
server/src/prompts/curation-rules.md
```

Edit it to refine coverage, anti-bias, dedup, field-filling, or web-search policy. Changes take effect on the next call (the file is re-read each time) — no restart, no code change. That file is the **default**: once an edit proposed through the chat (`propose_update_rules`) has been accepted, the stored copy in `taste_prompts` is what runs, and the file is only what the standard falls back to if that changeset is undone (`server/src/services/promptStore.ts`). The easiest way to change the rules is therefore to tell Claude — "from now on, never include concept cars" — and accept the diff it proposes.

The chat dock's own system prompt is short and lives in `server/src/services/agentRun.ts`; it reads the rulebook on demand (`get_curation_rules`) rather than carrying it in every call. The saved prompts behind the dock's `/` commands are the same idea one level up — `server/src/prompts/commands/*.md` as defaults, `taste_prompts` overrides on top, editable the same way (`propose_update_command`).

## Database migrations

SQL lives in [`supabase/migrations`](./supabase/migrations); run each once in the Supabase SQL editor. They are idempotent, so re-running is safe.

- `001_create_tables.sql` — the original datasets table.
- `002_physical_digital_and_rankings.sql` — renames stored domains to physical/digital and adds a summary **view** the app reads instead of whole rows. (Also created a `taste_rankings` table for a since-removed ranking feature — harmless to leave in place.)
- `003_world_maps.sql` — adds `taste_world_maps`, one row per world, holding its map (axes, regions, where every field and every proposed field sits). Until it's applied the shelf simply shows the grid.
- `004_jobs.sql` — durable rows for long curation calls, so research survives a closed tab.
- `005_personal_world.sql` — teaches the shelf view the `personal` world. Until it's applied, personal datasets are listed on the *physical* shelf instead of their own.
- `012_prompts.sql` — `taste_prompts`, the stored overrides for the curation rulebook and the saved `/` prompts. Optional until Claude first proposes a rules or prompt edit: reads treat a missing table as "no overrides", and only an accepted `prompt.update` needs it.

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
- Digital-world screenshots are rendered by **our own headless Chromium** against the Wayback Machine, with every non-`archive.org` request blocked so an archived page can't re-hydrate from the live web. When no usable snapshot exists it falls back to a screenshot of the **live site** — which is not the design of that year, so the item is badged **not period-accurate** in the gallery rather than passing silently. Swap the image to pick a nearer snapshot.
- Personal uploads are **images only** for now (JPEG, PNG, WebP, GIF, AVIF; 25 MB each) — an item is shown by an `<img>`. A book, film or album is represented by its cover (upload it, paste a URL, or use the image search), with an optional link to where it lives.
- UI is intentionally a **simple MVP** in the gallery aesthetic (warm beige, pill nav).
