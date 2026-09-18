# TasteTrainer — Architecture

These docs capture the **core decisions** for the project, one per aspect, in their simplest form. The goal (from `../ethos.md`) is a personal, local-first "bicycle for the mind": deliberately expose yourself to the best work humanity has made, train your eye through forced 1v1 judgement, and build defined taste.

We decide each aspect **doc by doc** before building. Each doc is short and uses the same shape:

- **Purpose** — what this aspect is.
- **The core decision(s)** — the key choice(s) to make.
- **Recommended default** — my suggestion + one-line why.
- **Open questions** — what you should weigh in on.

## The core themes

Numbered **1 → 6 by increasing concreteness** — from the abstract skeleton, through the data model, to the concrete features and the interface built on them. `7` is a later addition, extending the concrete build rather than the original skeleton-to-interface arc.

| Doc | The one core thing it decides |
|---|---|
| [1-setup.md](1-setup.md) | The skeleton — stack, runs on localhost, data lives as files on disk |
| [2-data.md](2-data.md) | What we store — the shape of a *dataset* and an *item* |
| [3-curation.md](3-curation.md) | How a dataset gets *made* with AI — topic → research → review → save |
| [4-images.md](4-images.md) | How each item gets a *real image* — Wikimedia + an alternative picker |
| [5-comparison.md](5-comparison.md) | How taste gets *trained* — 1v1 forced choice → a ranking *(removed 2026-09-18 — see Update below; browsing carries the app now)* |
| [6-ui.md](6-ui.md) | How you *use* it — the screen map, design language, and styling tooling that tie it all together |
| [7-software-design.md](7-software-design.md) | The deferred second domain — training taste in the *digital world* (websites, apps, product UI) alongside the *physical world* |
| [8-field-map.md](8-field-map.md) | The level *above* a dataset — auditing whether your set of fields is a good map of the world, finding the fields you don't know you're missing, and drawing the world as an actual 2D map |
| [9-personal-and-auth.md](9-personal-and-auth.md) | The subjective third world — hand-built datasets of what's *yours* (books, films, music, memories) from your own private files — and the sign-in wall in front of it *(narrowed to just that world 2026-09-18 — see Update below)* |

**UI lives in two places by design:** the *coherent whole* (screen map, visual language, styling) is owned by `6-ui.md`; *feature-specific interactions* stay in their feature doc (`3`–`5`), each flagged with a **UI →** pointer at the top. `2-data.md` has no UI of its own (it's the model the screens render).

## How to use these

Read a doc, accept or change the **Recommended default**, answer the **Open questions**. Once an aspect is decided, we expand it into detailed design + build steps. Nothing is built until the core ideas here are right.

**Status (2026-06-18):** all six docs have **confirmed core decisions** (each carries a *Resolved* / *Decisions locked* section). Only small, non-blocking residuals remain (era bucket size, exact "done" multiple, a look-and-feel reference). The plan is intended as the **canonical, regenerable source of truth** — the software is spun up from it, and can be wiped and regenerated if a core decision changes, so the docs are kept internally consistent.

**Update (2026-06-19):** the dataset view's filtering was redesigned — the always-visible chip rows became an on-demand **Filters subpage** (`/dataset/:id/filters`) with a SUBTOPIC view (fan-card collections) and an ERA view (a timeline of named **era-periods**). This added an optional `eraGroups[]` to the dataset (`2-data.md`) and a `proposePeriods` AI call (`3-curation.md`); the full screen/interaction spec is the *Resolved (2026-06-19)* block in `6-ui.md`.

**Update (2026-07-28):** two changes to the built app, both driven by use rather than by a new core decision, so they amend the docs above rather than adding an eighth.
- **Domains renamed** `hardware`/`software` → **`physical`/`digital`** (rationale and scope: the note at the top of `7-software-design.md`).
**Update (2026-08-04):** an alignment review of the whole project against `ethos.md`. Three
changes, plus a docs realignment.
- **New doc: [8-field-map.md](8-field-map.md)** — the structural hole the review found. Every
  AI capability audited the inside of a field; nothing audited the *set* of fields, so a map
  built one topic at a time quietly inherited the blind spots that named the topics. That is
  the failure mode this whole tool exists to prevent.
- **Era-first curation.** Periods are decided before items and become a per-era quota, so a
  set can't cluster in the era the model knows best; the Era filter finally has a UI, so
  `eraGroups` stops being generated-then-ignored. Amends `2-data.md`, `3-curation.md`, `6-ui.md`.
- **Honest capture.** Digital items record how their screenshot was obtained and are badged
  when it can't be showing the design of their year. Amends `4-images.md`, `7-software-design.md`.
- **The world drawn as a map** (same doc, later the same day). The shelf became a 2D canvas:
  fields in named regions on two named axes, gaps as dashed holes, cards dragged freeform.
  Its governing constraint is worth remembering — *Claude decides meaning, code decides
  pixels*, and a settled map is protected structurally rather than by asking the model
  nicely. Amends `6-ui.md`; needs migration `003_world_maps.sql`.
- **Docs realigned to the built app.** `1-setup.md` (deployed, Supabase — not localhost + JSON),
  `2-data.md` (same shape, different home), `3-curation.md` (HF Space proxy — not the Agent
  SDK), `4-images.md` (Commons fallback; the one exception to link-don't-store). These docs are
  meant to be regenerable into the software, so a stale one is worse than a missing one.

- **Rankings are per-person.** `5-comparison.md`'s one-ranking-per-dataset model became one ranking per *(dataset, name)*: you type a name arcade-style before ranking — no account — and the leaderboard gains a tab per person plus a pooled "Everyone" view. Storage moved from a single `taste_comparison_results` blob to a `taste_rankings` row per person, so a vote's cost doesn't grow with the number of people ranking.

**Update (2026-09-17):** **[9-personal-and-auth.md](9-personal-and-auth.md)** — a third, *subjective* world (`personal`: hand-built datasets of your own books, films, music and memories, from your own uploaded files) and a **sign-in wall** in front of the whole app. Amends `2-data.md` (`Domain` gains `personal`; same `Dataset`/`Item` shape), `4-images.md` (a second exception to link-don't-store: uploads live in a *private* bucket and are served as expiring signed URLs), `1-setup.md` (Supabase Auth; `ALLOWED_EMAILS` on the server, `VITE_SUPABASE_KEY` on the web) and `5-comparison.md` (the name plate stays, now *inside* the wall). Needs migration `005_personal_world.sql`.

**Update (2026-09-18):** two changes, both narrowing scope rather than adding to it.
- **`5-comparison.md`'s whole feature — 1v1 ranking, Elo, the leaderboard, the arcade name plate — is removed.** Browsing a dataset is the app's core value; the ranking half went unused and its own upkeep (per-person storage, a pooled "everyone" board) wasn't earning its place. `EloEntry`, `Ranker`, `ResultsFile`, `RankerSummary` and `LeaderboardRow` are gone from `2-data.md`'s shape; `taste_rankings` is unused but left in place in Supabase.
- **The sign-in wall now covers only the personal world**, not the whole app (amends `9-personal-and-auth.md`). The physical and digital worlds are researched, public-domain knowledge — never sensitive — so they're open; only personal uploads (private files, family photos) are worth the friction of an account. The server enforces this per-request (`server/src/auth.ts` — `attachUser` decodes a token if one is sent, `requireAuth` is mounted only where personal content is at stake), and the client gates only routes under `/personal` (`PersonalGate`, `web/src/lib/auth.tsx`).
