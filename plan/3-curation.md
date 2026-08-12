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
   - **Era-periods** (the other browsing axis — named time divisions like *Renaissance 1400–1600*; see `2-data.md`) are proposed too, but **at save time** rather than up front, because they're sized to the items' actual year span. They're stored on the dataset as `eraGroups[]` and power the Era filter timeline (`6-ui.md`). Generation is **best-effort**: if it fails, the dataset still saves and the Era timeline falls back to century buckets, with a **"Generate periods"** button to fill them in later. Existing datasets (made before this step) use the same button.
3. The backend asks **Claude** to return a clean list of items, **filling every field** for each one (`name`, `description`, `year`, `brand`, `creator`, `definingFact`, `subtopic`) — fully populated so you can just glance across a row to sanity-check it rather than fill gaps yourself. (`image` comes from the fetch step — see `4-images.md`.)
4. The app fetches an image per item and shows everything on a **review screen** — a grid of proposed items.
5. You **edit freely before saving**: deselect, fix text, swap images, or "ask Claude for more". Nothing is saved until you say so. **(Confirmed: review-before-save is the right default — fast init by Claude, final taste call by you.)**
6. **Save** writes the dataset to disk.

**After saving (full CRUD):** list all datasets, open one to rename/edit/add/delete items or re-fetch images, and delete whole datasets. "Add items" can be manual or "ask Claude for N more" — the expansion path is where coverage/dedup rules matter most (below).

**How it talks to Claude:** on your **Pro/Max subscription**, not a pay-per-use API key. Originally that meant the Claude Agent SDK borrowing this machine's Claude Code login; since deployment it means a self-hosted proxy that holds the subscription — see *How it works at runtime* below for the current mechanism.

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

> Everything above is *design decisions* (the what & why, settled before building). This section is *how the built code actually reaches Claude* — a learning/reference record of the implemented architecture. **Rewritten 2026-08-04**: the original described the Claude Agent SDK spawning a Claude Code CLI subprocess against `~/.claude/.credentials.json`. That worked while the app only ran on the machine you were logged into, and stopped being possible when the API moved to Render (`1-setup.md`, *Superseded*). The decision it implemented — **use the subscription, not metered API credits** — is unchanged; only the mechanism is different.

**The one-paragraph theory:** the server never calls a Claude HTTP API directly, and no API key exists anywhere in it. It POSTs to a **self-hosted Hugging Face Space** that holds the owner's Claude subscription and proxies the call, streaming the answer back as Server-Sent Events. Every curation feature funnels through **one function** — `runJson()` in `server/src/services/claude.ts` — the single place the model is reached.

> **This Space is shared, not TasteTrainer's own.** It's a generic relay — it knows nothing
> about curation, prompts, or JSON shapes; all of that is built entirely in *this* project's
> `server/src/services/claude.ts` and handed over as a finished `systemPrompt`/`prompt` pair.
> That's what makes the Space itself reusable: any project that builds its own prompts can
> share it. It currently also serves **IphoneClaude** (an unrelated personal iPhone chat app),
> each with its own `x-app-secret` (TasteTrainer's is `HF_APP_SECRET` → the Space's
> `APP_SHARED_SECRET`, the original/shared value).
>
> - **Source:** `../hf-space` (sibling folder, own git repo) — edit and push there, not here,
>   for anything that isn't curation-prompt-specific (timeouts, models, new endpoints, adding
>   a new caller).
> - **Live URL:** `https://roanjtaylor-claudesubscription.hf.space` — visit `/` for the
>   server's own landing page: current callers, env vars, and the OAuth token's real expiry.
> - **To onboard a future project:** mint it its own secret and add it to the `CALLERS` list
>   in the Space's `src/index.ts`, rather than reusing `HF_APP_SECRET` — so any one caller's
>   secret can be rotated without breaking the others.

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ BROWSER  (web/, React)                                                    │
 │   "Check this world" ─▶ api.reviewFieldMap(domain)                        │
 │   "Map the field"  ──▶ api.proposeSubtopics(...) then api.generatePeriods()│
 │   "Research best 12" ─▶ api.generateItems({..., eraGroups})               │
 │   "What's missing"  ──▶ api.findGaps(...)              [web/src/lib/api.ts]│
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  │  fetch POST /api/curation/…  (reads the
                                  │  SSE stream back — EventSource can't POST)
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ Vite proxy (dev) / VITE_API_BASE_URL → Render (prod)  [web/vite.config.ts]│
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ EXPRESS SERVER               [server/src/routes/curation.ts]              │
 │   every endpoint streams: event:progress … then one event:done|error      │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ CLAUDE SERVICE   runJson(system, prompt)   [server/src/services/claude.ts]│
 │   1. system = curation-rules.md (re-read from disk EVERY call) + JSON-only│
 │   2. prompt = domain line + this call's specifics                        │
 │   3. POST ${HF_BASE_URL}/api/chat   header x-app-secret: HF_APP_SECRET   │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼                       ★ THE AI CONNECTION ★
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ HUGGING FACE SPACE  (self-hosted proxy, owner's Claude subscription)      │
 │      streams back SSE:  event:delta ×N  ▶  event:done                    │
 │      runJson accumulates deltas, and counts completed JSON objects in     │
 │      the partial text to emit "Researching… 7 of 12 items" live           │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ runJson: extractJson(accumulated)  ─▶ parsed JSON  ─▶ back to the route   │
 └───────────────────────────────┬───────────────────────────────────────────┘
                                  ▼
        ┌─────────────────────────────────────────────────────────┐
        │ /items and /gap-fill ONLY: resolve each item's image      │
        │   physical ─▶ wikimediaImage(wikipediaTitle)              │
        │   digital  ─▶ screenshotForYear(url, year)                │
        │              (Wayback + our own Chromium — 7-software…)   │
        │   reports the OUTCOME per item on the same SSE stream     │
        └───────────────────────────┬─────────────────────────────┘
                                     ▼
                     final event:done ──▶ Browser renders
```

**The AI calls, by step:**

| UI action | Endpoint | Claude function | What Claude returns |
|---|---|---|---|
| Check this world | `POST /api/curation/field-map` | `reviewFieldMap` | the world's real division, fields you have no dataset for, boundaries drawn wrong, and which existing fields look thin — the level **above** a dataset (`8-field-map.md`) |
| Map / Re-map field | `POST /api/curation/subtopics` | `proposeSubtopics` | the canonical subtopic list, plus a `suggestedCount` sizing the collection |
| Map / Re-map field (same step) | `POST /api/curation/periods` | `proposePeriods` | named, contiguous, non-overlapping era-periods. **Called before any items exist** — the periods steer the research rather than describing it afterwards |
| Research the best N | `POST /api/curation/items` | `generateItems` | N items (`name`, `year`, `brand`, `creator`, `definingFact`, `subtopic`, and `wikipediaTitle` or `url`), distributed against an **explicit per-era quota** built from those periods — **then** each item's image is resolved, which is not a Claude call |
| What's missing | `POST /api/curation/gaps` | `findGaps` | thin / under-covered axes to expand next, **plus** a `suggestedCount` sizing the next add |
| Add what's missing | `POST /api/curation/gap-fill` | `fillGaps` | N new items that close the reported gaps (images resolved after, as for `/items`), **plus** a `note` explaining how the user's own feedback was weighed against the rules — folded in, or answered with a reason |

All of them build their system prompt from the editable rules file `server/src/prompts/curation-rules.md` (loaded fresh each call — see *Curation rules visibility* above), then hand it to the same `runJson()`.

### Billing & auth — still the subscription, reached differently

- **No `ANTHROPIC_API_KEY` is set**, and the server never injects one. The only secret it holds is `HF_APP_SECRET`, which authenticates *this app* to *our own proxy* — not to Anthropic.
- The subscription lives on the Space, not on the machine running the server. That is the whole reason for the indirection: a deployed server has no Claude login to borrow.
- **Cost is no longer reported per call.** The old SDK returned a `total_cost_usd` estimate; the proxy doesn't, so there's no per-run number to read. Usage still draws on the subscription's rate limits.

### The mental model (key takeaways)

1. **One chokepoint.** Every AI step goes through `runJson()`. Model (`CLAUDE_MODEL`, default `claude-opus-5`), transport, timeout, and JSON extraction all live there — one place to read or change AI behaviour.
2. **The connection is indirect, and deliberately so.** The server reaches a proxy we control, which reaches Claude. That's what makes "subscription, not API credits" survive deployment.
3. **Progress is inferred, not reported.** There's no structured progress channel — `runJson` counts occurrences of a key (`"name":`, `"topic":`) in the partial stream to say "7 of 12". It's an estimate of position, not a promise.
4. **Two prompts are structural, not advisory.** The era quota (`generateItems`) and the field-map review (`reviewFieldMap`) both work by giving the model a *checklist* rather than an instruction to be thorough. That distinction is the lesson worth keeping: "cover the eras" drifts; "here are 5 eras, fill each with 3" doesn't.
5. **Only image resolution touches a second service** — Wikimedia for physical items, Wayback + our own Chromium for digital ones (`server/src/services/images.ts`; see `4-images.md`, `7-software-design.md`). Neither hop is Claude.

---

## Open questions
- Cross-cutting **influence edges** (movement→movement, mentor→designer): worth adding to the data model eventually, or out of scope for the MVP? (Currently deferred — facets cover everything else.)
- Visual field preview (rendering the derived graph): a later feature — does it belong in its own doc when we get there?
