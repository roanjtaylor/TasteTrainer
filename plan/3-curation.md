# Curation — making a dataset with AI

> **UI →** this is the **Curate flow** screen (`6-ui.md`): topic → AI-proposed subtopics → review grid → save. The interaction details below are the UI; the global shell/visual language lives in `6-ui.md`.
>
> **How it works at runtime →** the *design decisions* are below; for *how the built code actually reaches Claude* (request path, the AI connection, billing/auth), jump to [How it works at runtime — the AI connection](#how-it-works-at-runtime--the-ai-connection).

**Purpose**
The heart of the tool. You pick a topic; Claude does the research grunt-work (finding the names of the best work and why they're great); you review and tidy before saving. The model does the hard part so you can build great reference sets in minutes instead of hours — your fast-track to exposure.

But "the best work" isn't enough on its own. The deeper job of curation here is to surface the **objective reality of a field** — the key work that actually defines it — not just the famous corners you (or the model) already know. See *Curation quality* below; it's the part that's easy to get wrong.

**The core decision(s)**
1. **The flow** — how a dataset gets created, start to finish.
2. **What Claude returns** — research output, not images (images are handled in `4-images.md`).
3. **How the app talks to Claude** — which access path.
4. **What you can do after** — editing/extending/deleting.
5. **Curation quality** — how we avoid duplicates and bias, and cover the whole field (incl. the parts we don't know we're missing).
6. **Curation rules visibility** — the prompt/principles are editable by you, not a blackbox.

---

## Decisions (confirmed 2026-06-18)

**Flow (topic → research → review → save):**
1. You type a **topic** and roughly **how many** items (e.g. "20 most iconic chairs").
2. On a **new topic**, Claude first proposes the **subtopics** (the canonical axes of the field — see `2-data.md`) so the dataset is initialised with a sound structure before any items are added.
3. The backend asks **Claude** to return a clean list of items, **filling every field** for each one (`name`, `description`, `year`, `brand`, `creator`, `definingFact`, `subtopic`) — fully populated so you can just glance across a row to sanity-check it rather than fill gaps yourself. (`image` comes from the fetch step — see `4-images.md`.)
4. The app fetches an image per item and shows everything on a **review screen** — a grid of proposed items.
5. You **edit freely before saving**: deselect, fix text, swap images, or "ask Claude for more". Nothing is saved until you say so. **(Confirmed: review-before-save is the right default — fast init by Claude, final taste call by you.)**
6. **Save** writes the dataset to disk.

**After saving (full CRUD):** list all datasets, open one to rename/edit/add/delete items or re-fetch images, and delete whole datasets. "Add items" can be manual or "ask Claude for N more" — the expansion path is where coverage/dedup rules matter most (below).

**How it talks to Claude:** the **Claude Agent SDK using your Pro/Max subscription** (the same login Claude Code uses) — no separate pay-per-use API key, no extra cost. **(Confirmed: you're logged in on this machine.)**

**Web search:** **on by default for newer/cutting-edge topics**, where the model's training may be stale or thin. For the majority of "best of" topics that are well-settled (e.g. 90s watches, classic cars), the model's own knowledge + Wikipedia titles will usually suffice, so search can be skipped to stay fast. Rule of thumb baked into the curation prompt: *search when recency or completeness is in doubt; otherwise answer from knowledge.*

**Fields Claude always fills:** all item fields listed above (ties to `2-data.md`). Confirmed: fill everything, every time.

---

## Curation quality — the part that's easy to get wrong

The failure mode to design against: the model returns the **obvious, top-of-mind, popularity-weighted** picks and quietly omits whole regions of the field. For *cars*, that looks like a list of best-selling Mercedes models while BMW, Citroën, Honda, Lancia and the design movements they represent never appear. The result *looks* authoritative but is a biased slice — it teaches a distorted taste.

The guiding principle: **find what you don't know that you don't know.** The tool must actively map the *whole* field — its key brands, schools, eras, and design directions — and pull the defining work from each, not just the corners already familiar to the user or the model. The goal is to show the field's objective reality, not to confirm what's already widely recognised.

Concretely, the curation logic should:

- **Cover the field's axes, not just its hits.** Before listing items, have the model enumerate the field's *dimensions* — major makers/schools, eras, sub-genres, regions — then deliberately draw items across them. (The subtopics from step 2 are the start of this, but coverage must also span brands/movements/eras *within* subtopics.) Aim for representativeness, not a popularity ranking.
- **Explicitly counter popularity bias.** Instruct the model that "best-selling / most-famous" ≠ "most defining". Include the work that *shaped* the field even if it's less mainstream; avoid over-indexing on one dominant name.
- **De-duplicate on expansion.** When "ask Claude for N more", pass the **existing items** (names + subtopics + brands) into the prompt and instruct: no repeats, and *prefer filling under-represented areas* of the current set. Each expansion should widen coverage, not deepen an existing cluster.
- **Surface gaps (a button, on demand).** A **"what's missing?" button** runs a breadth-first sweep of the field and reports which axes are thin or missing ("no representation of pre-1960 work; no Japanese makers") so you can target the next expansion — turning unknown unknowns into known, fillable gaps. (Decided: a button you press, not automatic after every build — keeps normal curation fast.)
- **Breadth before depth.** Priority order is **breadth across the whole field first, depth second.** Fill the broad set across all axes (e.g. complete the 1930s mechanical-watch set across brands/movements) *before* delving deeper into any one node. Breadth is the point of the tool — it gives you the full map of a field's design space; depth is something you grow into afterwards by expanding a chosen node.

This is the core intelligence of the product; it's worth getting the prompt logic right even at the cost of more model calls.

### Structure: a graph of nodes, derived from faceted items

Breadth-then-depth implies the field is a **network of connected nodes** (subtopic → era → brand → creator → item, with cross-links), not a flat list — and this also powers visual field previews later. **This is decided and owned by `2-data.md` §5:** the flat, faceted `items[]` list stays the source of truth (the facets *are* the connections), and the graph/tree is a **derived projection** computed on the fly — no stored edges until a relationship can't be derived from facets (e.g. movement→movement *influence*), which is deferred. See `2-data.md` §5 for the full rationale; curation just needs to know it should fill facets richly so that derived graph is complete.

---

## Curation rules visibility — not a blackbox

The curation behaviour above lives in a **single editable rules file** (see implementation note below), not buried in code. You can read, edit, and refine the rules over time so curation improves with feedback (e.g. "results still skew to one brand → tighten the anti-popularity rule"). Two reasons this matters:

1. **Quality control via feedback.** When a set comes out biased or shallow, you fix the *rule*, not just that one set — improvements compound across every future dataset.
2. **Learning.** Seeing the actual principles/prompts fed to the model — and how the agent uses them — builds your own theory of how these models/agents work, which is part of the point of building this.

*Implementation note (for later docs):* keep the curation rules in a **single global rules file** — one plain, versioned text/markdown file the app loads at runtime (so editing a rule needs no code change), with clear sections for (a) field-mapping/coverage, (b) anti-bias, (c) dedup-on-expansion, (d) field-filling, (e) web-search policy. (Decided: one global file, not per-field-type overrides — keeps the rules simple and learnable; if a field ever needs special handling, a section in the same file can branch on it.)

---

## How it works at runtime — the AI connection

> Everything above is *design decisions* (the what & why, settled before building). This section is *how the built code actually reaches Claude* — a learning/reference record of the implemented architecture (added 2026-06-19, after getting the flow working end-to-end).

**The one-paragraph theory:** the server never calls a Claude HTTP API directly. It uses the **Claude Agent SDK**, which **launches a Claude Code CLI program as a background subprocess**. That subprocess logs in with **your Claude subscription** (the same `~/.claude` login Claude Code uses), talks to the model, and streams the answer back as JSON. Every curation feature funnels through **one function** — `runJson()` in `server/src/services/claude.ts` — the single place the model is reached.

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ BROWSER  (web/, React)                                                    │
 │   "Map the field"  ──▶ api.proposeSubtopics(topic, description)           │
 │   "Research best 12" ─▶ api.generateItems({topic, subtopics, count,...})  │
 │   "What's missing"  ──▶ api.findGaps(...)              [web/src/lib/api.ts]│
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  fetch  POST /api/curation/...
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ VITE DEV PROXY   localhost:5173  ──▶  127.0.0.1:5174   [web/vite.config.ts]│
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ EXPRESS SERVER  :5174        [server/src/routes/curation.ts]              │
 │   /subtopics ─▶ proposeSubtopics()                                        │
 │   /items     ─▶ generateItems()  ─┐                                       │
 │   /gaps      ─▶ findGaps()        │                                       │
 └───────────────────────────────────┼───────────────────────────────────────┘
                                      ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ CLAUDE SERVICE   runJson(system, prompt)   [server/src/services/claude.ts]│
 │   1. build prompt = curation-rules.md  +  your topic/subtopics            │
 │   2. getQuery()  → lazy-load Agent SDK (cached after first call)          │
 │   3. query({ prompt, model: claude-opus-4-8, cwd: scratch, abort })       │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼                       ★ THE AI CONNECTION ★
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ CLAUDE AGENT SDK  ─▶ spawns a CLAUDE CODE CLI subprocess                  │
 │                                                                           │
 │      auth ──▶ ~/.claude/.credentials.json  (claudeAiOauth)               │
 │              └─ YOUR SUBSCRIPTION  (no API key = no credit billing)       │
 │                                                                           │
 │      CLI ──────────────── network ───────────────▶  CLAUDE MODEL         │
 │                                                      (Opus 4.8)           │
 │      streams back:  system ▶ assistant ▶ result(JSON text)               │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ runJson: extractJson(result)  ─▶ parsed JSON  ─▶ back up to the route     │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
        ┌─────────────────────────────────────────────────────────┐
        │ /items ONLY: for each item, fetch a lead image           │
        │   wikimediaImage(wikipediaTitle)  ──▶  Wikimedia REST API │
        │                       [server/src/services/images.ts]    │
        │   (this hop is NOT Claude — just an image lookup)         │
        └───────────────────────────┬─────────────────────────────┘
                                     ▼
                         JSON response ──▶ Vite proxy ──▶ Browser renders
```

**The three AI calls, by step:**

| UI action | Endpoint | Claude function | What Claude returns |
|---|---|---|---|
| Map / Re-map field | `POST /api/curation/subtopics` | `proposeSubtopics` | the canonical subtopic list |
| Research the best N | `POST /api/curation/items` | `generateItems` | N items (`name`, `year`, `brand`, `creator`, `definingFact`, `subtopic`, `wikipediaTitle`) — **then** each item's image is fetched from Wikimedia, not Claude |
| What's missing | `POST /api/curation/gaps` | `findGaps` | thin / under-covered axes to expand next, **plus** a `suggestedCount` sizing the next add |
| Add what's missing | `POST /api/curation/gap-fill` | `fillGaps` | N new items that close the reported gaps (images fetched after, as for `/items`), **plus** a `note` explaining how the user's own feedback was weighed against the rules — folded in, or answered with a reason |

All three build their prompt from the editable rules file `server/src/prompts/curation-rules.md` (loaded fresh each call — see *Curation rules visibility* above), then hand it to the same `runJson()`.

### Billing & auth — uses your subscription, not API credits

- **No `ANTHROPIC_API_KEY` is set**, and the server never injects one.
- `~/.claude/.credentials.json` holds `claudeAiOauth` (with `subscriptionType` / `rateLimitTier`) — the **Claude Code subscription login**.
- So curation runs draw on your **subscription usage** (counts against your plan's rate limits), **not** pay-per-use API credits (matches the *How it talks to Claude* decision above).

**The cost number is an estimate, not a charge.** The SDK reports `total_cost_usd` (~$0.50 for an item-research call). That's the *equivalent API price* — a rough gauge of how much subscription headroom a run eats — **not** money off a card.

> ⚠️ **Auth precedence caveat:** `ANTHROPIC_API_KEY` **wins if it's ever set** in the environment. If you (or a tool) export that variable, the same code silently switches to billing API credits. Today it's unset, so you're on the subscription.

### The mental model (key takeaways)

1. **One chokepoint.** Every AI step goes through `runJson()` in `server/src/services/claude.ts`. Model choice (`claude-opus-4-8`), auth, timeout, and the subprocess all live there — one place to read or change AI behaviour.
2. **The connection is indirect.** The server doesn't hit an API endpoint; it **spawns the Claude Code CLI**, which uses your subscription login to reach the model. That indirection is why the cost shows as an *estimate*, and why a launch/tooling problem (not app logic) once made it hang — see the dev-runner note in `server/src/index.ts`.
3. **Only item research touches a second service** — Wikimedia, for images (`server/src/services/images.ts`; see `4-images.md`). That hop has nothing to do with Claude.
4. **Debugging hook:** run `DEBUG_CLAUDE_SDK=1 npm run dev` for an unbuffered, step-by-step log of the Claude calls in your OS temp folder (`tastetrainer-claude-debug.log`), reliable even when console output is hidden. If curation stalls, that file shows which step stalled.

---

## Open questions
- Cross-cutting **influence edges** (movement→movement, mentor→designer): worth adding to the data model eventually, or out of scope for the MVP? (Currently deferred — facets cover everything else.)
- Visual field preview (rendering the derived graph): a later feature — does it belong in its own doc when we get there?
