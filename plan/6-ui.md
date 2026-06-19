# UI — how you actually use it

**Purpose**
The most concrete layer, and for *this* tool a load-bearing one: a system for training taste must itself **demonstrate** taste. This doc owns the **coherent whole** of the interface — the map of screens, how you move between them, and the visual language they share. Feature-specific interactions (the curation review grid, the image picker, the 1v1 compare) stay in their own docs (`3`–`5`); this doc is the frame that holds them together so the app feels like one thing — and so the software can be regenerated from the plan without the UI drifting between rebuilds.

**The core decision(s)**
1. **Screen map** — what screens exist and how you navigate between them.
2. **Design language** — the visual identity / aesthetic the whole app shares.
3. **Styling tooling** — what we build the UI with (resolves the item deferred in `1-setup.md`).

---

## Recommended default

### 1. Screen map (~3 main screens + a filter subpage)
A small, flat set — no deep nesting. A **persistent top nav** (see below) moves between the shelf and an open dataset.

1. **Datasets home** — the shelf. Every macro topic you've made as a card; a prominent **"+ New dataset"**. Entry point.
2. **Curate flow** — creating/expanding a dataset: topic → AI-proposed subtopics → review grid → save. *(Interaction detail: `3-curation.md`; image picker within it: `4-images.md`.)*
3. **Dataset view** (`/dataset/:id`) — open a dataset to **browse AND rank it in one place** (*browse* and *train* are modes of one screen, not separate destinations — kept merged for MVP simplicity):
   - **Browse:** the gallery of items currently in scope. Where you *look*. Hosts the **"what's missing?"** button.
   - **Rank:** the 1v1 forced choice → progress toward a size-based "done" target → leaderboard for that slice. *(Interaction detail: `5-comparison.md`.)*
   - **Filtering is on-demand, not always-on.** Rather than permanent rows of filter chips, a **Filters** button sits inline with the browse/rank/leaderboard switch and opens the **Filters subpage** (below). The chosen filter is shown back as a small **pill + count** (e.g. *Impressionism ✕ · 12 of 58 items*) and scopes **all three modes** (browse, rank, leaderboard) alike. **One filter at a time** — a single subtopic **or** a single era-period, not both. The active filter lives in the URL (`?sub=…` / `?era=start-end`) so it's shareable and the back button steps through it.
4. **Filters subpage** (`/dataset/:id/filters`) — a deliberately *delightful* way to pick a slice, with a **SUBTOPIC | ERA** axis switch:
   - **Subtopic view** — each subtopic rendered as a **fan of cards**: its first ≤3 item images spread like a hand, with a **"+N more"** badge, so a subtopic reads as a *collection*, not a word. Click a fan → drill into that subtopic.
   - **Era view** — a horizontal **timeline**: a works-per-decade line graph with a **key work pinned** per period, above a band of named, hoverable **era-periods** (`eraGroups`, `2-data.md`). Click a period → drill into that time range. The timeline uses an **equal-width-per-period ("banded") x-scale**: each era gets the same horizontal slot, so the graph slice and pinned work sit **directly above that era's button** and the highlight aligns — making "which eras hold more work" read at a glance. (Within a slot, time still flows left→right by the era's own span; exact years aren't lost — each segment prints its year range.) This is a deliberate trade of strict year-proportionality for label readability + alignment, since recent history packs many short periods that proportional widths would cram unreadably. When a dataset has no AI periods yet, century buckets show with a **"Generate periods"** button. *(Interactive zoom-to-year is **deferred post-MVP**.)*
   - Picking anything returns to the Dataset view filtered to that slice.

*Why:* the loop is **build → browse → rank → see ranking**; moving filtering behind a button keeps the everyday view calm and image-forward, while the fan/timeline subpage makes *choosing a slice* itself feel like browsing a collection — fitting a taste tool.

### 2. Design language — the app should have taste
The work is the hero; the chrome disappears. A **quiet, gallery/museum aesthetic**:
- **Image-forward, content-first.** Generous whitespace, large clean imagery, minimal UI furniture around it. The interface frames the work like a gallery wall, never competes with it.
- **Light beige "gallery wall" background** — a soft, warm off-white (think museum/gallery walls), **not** the harsh bright white of a default screen. Near-black text; one restrained accent. Type does the structuring, not boxes and borders.
- **Calm, fast, low-friction.** Especially when ranking — the rhythm of rapid binary choices is the training, so transitions are instant and distraction-free.
- **Navigation:** a **persistent, centred pill-style top nav** (a floating rounded bar), not a full-width banner — light and modern, in keeping with the gallery calm.

**MVP scope for design:** keep it **simple now** — establish the beige gallery feel, clean type, and the pill nav, but don't over-polish. The real design refinement comes later, once **digital/website design** datasets are in and the tool is used to rank *websites* (the milestone proof that it sharpens the user's taste — at which point the app's own look gets the full treatment).

*Why:* you can't credibly build a taste tool inside an ugly one — the aesthetic is part of the product, and a consistent language is what lets a regenerated build still feel like *this* app; but MVP simplicity beats premature polish.

### 3. Styling tooling
- **Tailwind CSS** for styling — fast to build, extremely AI-assistable (serves the regenerate-from-plan goal), and easy to keep consistent via a small set of tokens.
- **shadcn/ui** for base components (cards, dialogs, buttons) — unstyled-but-accessible primitives you own and restyle to the gallery language, rather than fighting a heavy component library.

*Why:* maximises AI-assist quality and consistency (same reasoning as the TypeScript choice in `1-setup.md`), while keeping the look fully under your control.

---

## Resolved (2026-06-18)
1. **Navigation = persistent centred pill-style top nav** (floating rounded bar), not a full-width banner.
2. **Browse + Rank merged into one Dataset view** — they're modes of the same screen, not separate destinations. (Cleared up the confusion: *browse* = looking at items; *rank* = the 1v1 training that builds the leaderboard. Simplest structure for MVP.)
3. **Graph/visual field preview** — deferred post-MVP.
4. **Background = light beige** (gallery/museum wall warmth), not bright screen-white. Light-only for now.
5. **Simple MVP design now**, full design refinement later — timed to when digital/website-design datasets land (the milestone use case).

## Resolved (2026-06-19) — the Filters subpage redesign
Replaced the always-visible subtopic/era **chip rows** with an on-demand, visually richer filter flow. Decisions:
1. **Filters live behind a button** inline with browse/rank/leaderboard, opening a **real route** `/dataset/:id/filters` (back button + shareable URL).
2. **Drill-in, single-select**: clicking a subtopic fan or an era-period enters the filtered view; picking another replaces it.
3. **One axis at a time** — a subtopic **or** an era-period, never both at once.
4. **Scope reach = all three modes** (browse/rank/leaderboard), via the same `ScopeQuery` as before.
5. **Subtopic view = fan cards** (first ≤3 items + "+N more"); **Era view = timeline** (works-per-decade line graph + a key work pinned per period) over a band of named **era-periods**.
6. **Era-periods (`eraGroups`) are AI-generated** per dataset and stored (`2-data.md`); existing datasets get a **"Generate periods"** button; a **century-bucket fallback** renders when absent.
7. **Era filter unit = the period band** (a named range); decades are visual context, not individually clickable. The whole timeline uses an **equal-width-per-period ("banded") x-scale** — band, graph, and pinned works all share equal era slots, so each era's curve aligns directly above its button (label readability + at-a-glance "which eras hold more work"); time still flows left→right within a slot and each segment prints its year range (added 2026-06-19).
8. **Active filter = pill + count** next to the Filters button; state encoded in the URL (`?sub=` / `?era=start-end`).
9. **Interactive zoom-to-year on the timeline = deferred post-MVP** (the static timeline + period band is the MVP).

**Small residual to confirm (non-blocking)**
- A concrete look-and-feel reference (e.g. Are.na, a museum site) would sharpen the beige-gallery language fast when we get to building — optional, can name it later.
- **Timeline zoom-to-year** — the deferred interaction (pinch/scroll to drill the timeline from decade to year); revisit once the field is used heavily.
