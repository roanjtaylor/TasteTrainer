# Data — what we store

**Purpose**
At its foundation TasteTrainer is a custom tool for **discovering, cataloguing, organising, browsing and ranking the best of past human work** in a field (artwork, watches, cars, fashion, …) so you can develop real taste in it. This doc fixes the shape of that catalogue: how work is **grouped**, and what we record about each piece. Get this right and browsing, filtering, and ranking all fall out of it.

## Settled shape

### 1. Hierarchy — a macro topic, with two filterable axes
A **dataset = a macro topic** (the field you're cataloguing), e.g. *Watches*, *Paintings*, *Cars*, *Fashion*. It's the unit you create and store.

Within a dataset, every item sits on two **independent, filterable** axes:

- **Subtopic** — the type / category / model. Each subtopic has a **`name` and a short `description`** (a mini-definition that guides both the AI's sorting and your eye). **Canonical and AI-initialised:** when you create a macro dataset, the curation step **proposes the subtopic list up front**, which initialises the structure items are then sorted into. The list is canonical (a fixed, tidy set per dataset) so filtering stays clean; you can edit it. **Each item belongs to exactly one subtopic.** Example for a *Watches* dataset:
  - **Mechanical Watches** — Manual and automatic timepieces.
  - **Quartz & Battery Watches** — Traditional analog, battery-powered timepieces.
  - **Digital & Electronic Watches** — Timepieces with LCD/LED digital displays.
  - **Smartwatches & Wearables** — Connected devices with health tracking and apps.
  - **Luxury & High Horology** — Artisanal, rare, and high-end collector timepieces.
  - **Tool & Sports Watches** — Purpose-built designs like dive, pilot, and field watches.
  - **Fashion & Designer Watches** — Style-focused timepieces made by clothing or lifestyle brands.
- **Era** — the time range, e.g. *1990s*. **Derived, not stored:** era is computed from each item's `year` (default bucket = decade). No separate era field to keep consistent — the years do the work, and a dataset's eras are simply the decades its items span.

"Independent" means you can browse the **whole macro topic**, or narrow by **subtopic AND/OR era** — e.g. *Watches → 1990s*, or *Paintings → Nature landscapes → 1960s*. Build a broad macro set first, then discover niches and compare at any depth (this powers the filtering + scoped ranking in `comparison.md`).

### 2. Item fields
- `name` — what it is (e.g. "Eames Lounge Chair").
- `description` — short note on *why it's considered great* (looking → perceiving).
- `image` — the **web address** of the picture (URL only; see #3).
- `year` — when it was made / released. **Drives the derived era.**
- `brand` — the company / maker, where applicable (e.g. *Patek Philippe*, *Herman Miller*). Empty for works with no company (e.g. a painting).
- `creator` — the **individual** responsible: lead designer, artist, architect (e.g. *Gérald Genta*, *Van Gogh*).
- `definingFact` — a one-sentence fun/notable fact that gives the item soul (e.g. "best-selling car of its year", "famously unreliable among owners", "copied over a million times").
- `subtopic` — the one canonical subtopic it belongs to (references an entry in the dataset's `subtopics[]`).
- plus hidden `id`, `createdAt`.

*(`maker` is split into `brand` + `creator`; `era` is derived from `year`; the old `source` field is dropped — see #3.)*

### 3. Images — link, don't store
Items hold a **URL only**; we do **not** download images. Storage stays tiny, and a dead link is fixed by pasting a new address. The old `image` + `source` fields are now a **single `image` URL** — the address is both the picture and where it lives. No separate source/attribution field.
> Propagated into `images.md` so the docs agree.

### 4. On disk
```
data/
  datasets/<id>.json          # one macro topic per file
  results/<datasetId>.json     # comparison outcomes / rankings (see comparison.md)
```
A **dataset** record holds: `id`, `topic` (the macro name), **`description` (required)**, `subtopics[]` (each `{ name, description }`, the canonical AI-initialised list), `items[]`, `createdAt`, `updatedAt`. Eras are **derived** from item `year`s, not stored. Subtopics are a browsing/grouping structure *within* the one file — not separate folders on disk — so the catalogue stays a single, inspectable JSON per macro topic.

The dataset `description` is **required** — a concise capture of the field's core idea (e.g. *Cars — machines for transport across land on tyres*). Forcing this one sentence keeps each catalogue's scope clear and well understood.

*Why this shape:* it supports the full loop — *expose* (image), *perceive* (description + defining fact + maker), *internalize* (rank within any slice), *apply* (your own reference catalogue) — while staying a simple pile of JSON, one file per field.

## Decisions locked (2026-06-18)
- `maker` → **split** into `brand` (company) + `creator` (individual designer/artist). ✅
- Subtopics are **canonical** and **AI-suggested at dataset creation** to initialise the structure; each subtopic is `{ name, description }`. ✅
- Dataset **`description` is required** (concise core-idea capture). ✅
- **One subtopic per item.** ✅
- **Era derived from `year`** (default = decade); no stored era field. ✅
- **Source dropped** — the `image` URL is the only address we keep. ✅

## Small residual to confirm (non-blocking)
- **Era bucket size** — decade (*1990s*) as the default grouping; OK, or do some fields want finer (5-year) / coarser (mid-century) buckets? Can stay decade and revisit.
- **Subtopic at add-time** — when adding a *new* item later, must it use an existing canonical subtopic, or can the AI propose a new subtopic to extend the list? (Lean: reuse existing; allow deliberate "add a subtopic".)
