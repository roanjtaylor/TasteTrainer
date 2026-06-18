# UI — how you actually use it

**Purpose**
The most concrete layer, and for *this* tool a load-bearing one: a system for training taste must itself **demonstrate** taste. This doc owns the **coherent whole** of the interface — the map of screens, how you move between them, and the visual language they share. Feature-specific interactions (the curation review grid, the image picker, the 1v1 compare) stay in their own docs (`3`–`5`); this doc is the frame that holds them together so the app feels like one thing — and so the software can be regenerated from the plan without the UI drifting between rebuilds.

**The core decision(s)**
1. **Screen map** — what screens exist and how you navigate between them.
2. **Design language** — the visual identity / aesthetic the whole app shares.
3. **Styling tooling** — what we build the UI with (resolves the item deferred in `1-setup.md`).

---

## Recommended default

### 1. Screen map (the whole app is ~3 screens)
A small, flat set — no deep nesting. A **persistent top nav** (see below) moves between the shelf and an open dataset.

1. **Datasets home** — the shelf. Every macro topic you've made as a card; a prominent **"+ New dataset"**. Entry point.
2. **Curate flow** — creating/expanding a dataset: topic → AI-proposed subtopics → review grid → save. *(Interaction detail: `3-curation.md`; image picker within it: `4-images.md`.)*
3. **Dataset view** — open a dataset to **browse AND rank it in one place** (*browse* and *train* are modes of one screen, not separate destinations — kept merged for MVP simplicity):
   - **Browse:** the faceted gallery (filter by **subtopic AND/OR era**), rendered from the derived graph (`2-data.md`). Where you *look*. Hosts the **"what's missing?"** button.
   - **Rank:** pick a scope (dataset / branches), then the 1v1 forced choice → progress toward a size-based "done" target → leaderboard for that slice. *(Interaction detail: `5-comparison.md`.)*

*Why:* the loop is **build → browse → rank → see ranking**; three screens map it with nothing to get lost in, and merging browse+rank into the Dataset view keeps the MVP as simple as possible (per your steer).

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

**Small residual to confirm (non-blocking)**
- A concrete look-and-feel reference (e.g. Are.na, a museum site) would sharpen the beige-gallery language fast when we get to building — optional, can name it later.
