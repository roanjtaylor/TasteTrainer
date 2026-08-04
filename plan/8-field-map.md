# The field map — auditing the world, not the field

> **UI →** this doc owns one new screen (`/:domain/map`) and one new entry point on the
> shelf; the visual language it inherits lives in `6-ui.md`.

**Purpose**

Every AI capability built before this one looks *inside* a field: subtopics for a field,
items for a field, gaps within a field. Nothing ever asked whether the **set of fields** is
any good.

That's a real hole, and it sits exactly where this tool is most likely to fail its own
premise. `ethos.md` is about exposure to the best of what humanity has made; the point of
curating breadth-first (`3-curation.md`) is to *find what you don't know that you don't
know*. But the fields themselves were always named by hand, one at a time, out of whatever
the user already knew existed. A map assembled that way inherits the blind spots of
whoever named the topics — and then quietly becomes "the map", because nothing in the
product ever questions it. The tool would confirm your starting understanding rather than
widening it: the precise opposite of what it's for.

The symptom was visible in the code. The digital world's list of fields to study was
**fourteen hardcoded suggestions in a TypeScript file** — a fixed, human-guessed taxonomy,
in the one world the user says they understand least, improvable only by editing source.
That's a cage around the model rather than a harness for it.

**The core decision(s)**
1. **What level does it audit** — one field, or the shelf?
2. **What does it return** — coverage only, or structure too?
3. **What does it cost to act on a finding?**

---

## Recommended default

### 1. It audits the shelf, and it is one level up — not a bigger gap sweep

`findGaps` ("what's missing?") stays exactly as it is: items within one field. The field
map is a separate call over a **compact inventory of every dataset in one world** — topic,
description, subtopic names, item count, dated year span. **Items are deliberately not
sent.** Two reasons: a whole world's items would swamp the prompt, and including them pulls
the model down into per-item critique, which is the other call's job done worse.

The inventory is assembled **server-side** from storage, not posted by the client. The
shelf listing the client holds has no subtopic names and no year spans, and the review is
only as good as those.

### 2. It returns four things, and three of them are structural

- **`mapSummary`** — one paragraph on how this world genuinely divides. The teaching part:
  it describes the shape to build toward, not what you already have.
- **`missingFields[]`** — fields with no dataset yet, each with a `topic` and `description`
  ready to curate and a `why` that argues its case. **This is the unknown-unknowns
  surface** and the reason the screen exists.
- **`boundaryIssues[]`** — `merge` / `split` / `rename` on existing fields. Coverage isn't
  the only way a map goes wrong; a badly drawn boundary from month one is otherwise
  permanent, because nothing else in the app ever proposes redrawing one.
- **`thinFields[]`** — existing fields that look under-built from the counts alone, each a
  pointer to go run that field's own gap sweep.

### 3. A finding costs one click

Every missing field carries **"Curate this →"**, which opens the Curate flow with the topic
and description pre-filled. Check → see the gap → build it, with nothing retyped. A review
you have to act on manually is a review you stop running.

### 4. The rules live in the same editable file as everything else

The prompt is section **(g)** of `server/src/prompts/curation-rules.md`, re-read from disk
on every call like the rest. Same reasoning as `3-curation.md`: feedback improves the
*rule*, so the gain compounds across every future review, and you can read exactly what the
model was told. A world-level audit whose criteria were buried in TypeScript would be the
same mistake as the hardcoded field list it replaces.

---

## Resolved (2026-08-04)

1. **Branch-level review, chosen over deepening the per-dataset sweep.** The missing level
   was the whole point; making `findGaps` critique its own dataset's subtopics would not
   have surfaced a single field the user doesn't have.
2. **`web/src/lib/digitalFields.ts` deleted.** The Curate screen's "not sure what to study?"
   box now links to the field map instead of listing fourteen fixed topics. The list was a
   reasonable stopgap when the digital world was new; keeping it would have meant a
   hand-maintained taxonomy competing with a generated one, and the hand-maintained one
   improves only when someone edits it.
3. **Works on an empty shelf.** With no datasets the call becomes "what are the fields of
   this world?" — exactly what the hardcoded list answered, now from the model and getting
   better as the models do.
4. **Findings are advisory; nothing is applied automatically.** Boundary issues describe a
   change for the user to make by hand (rename and delete already exist behind *Edit
   datasets*). Auto-merging datasets would be a destructive operation driven by a
   suggestion — not a trade worth making, and not needed to get the value.

---

## The map, made spatial (2026-08-04)

The review above is prose: a paragraph, three lists. That reports the shape of a world
without ever *showing* it — and "show me the shape" is the thing a map is for. So the
same review now also draws one, and the world's shelf (`/:domain`) becomes it.

**What it looks like.** Fields sit inside named regions, positioned on two axes the
world is laid out along — for objects, something like *held → inhabited* across and
*practical → expressive* up. A card's size grows with its item count, so depth reads
next to breadth. Fields you don't have yet are **dashed ghost cards** in the region they
belong to: a gap stops being a bullet point and becomes a visible hole. A region you've
barely built fades toward transparent, so your blind spots are legible from across the
room rather than needing to be read.

### The core decision: Claude decides meaning, code decides pixels

A model asked to lay out a world twice gives two different answers. A map that
rearranges itself between visits is not a map — you can never build a mental picture of
it, which is the entire reason to make it spatial. So the job is split:

- **Claude** returns the axes, the regions, each region's position on those axes as
  0–1, and which region each field belongs to. All semantic. It never returns pixels.
- **`web/src/lib/mapLayout.ts`** turns that into a canvas — deterministically, with no
  `Math.random` anywhere, so the same map always renders identically.

This is not a hedge against bad models; it plays to what models are reliable at.
"Is a watch held or inhabited" is a judgement. "x=340, y=112" is not.

### Stability is structural, not requested

The rulebook tells the model an existing map is settled. That's a request. The
guarantee is in `server/src/services/worldMap.ts`: when a map exists, `mergeProposal`
takes **only** new placements and suggestions out of a response, and never axes or
regions. A model that ignores the instruction — or a future one that reads it
differently — still cannot scramble a map you've learned.

Everything else follows from that:
- **Placement is additive.** A field already on the map is never re-placed.
- **Change arrives as `suggestions`** you accept or dismiss, capped at four per review,
  and only in the three kinds that can be applied mechanically: add a region, move a
  field, rename a region. Anything bigger stays advice in `boundaryIssues`, because
  acting on it means moving items between datasets and a suggestion isn't consent.
- **Dragging wins permanently.** A dropped card is `pinned`; layout never touches it
  again, and the next review is *told* you placed it so it stops arguing. Freeform on
  purpose — a macOS desktop, not a Windows grid. **Tidy up** clears every pin and
  re-flows, which is macOS "Clean Up" exactly.
- **Dropping a card in another region re-files it there.** Disagreeing with Claude's
  placement is real information about how *you* divide the world, so it's kept.

### Resolved (2026-08-04)

1. **The map is the shelf's default view**, with a `Map | Grid` toggle in the URL
   (`?view=grid`). The grid stays because "just take me to Cars" is a real need the map
   serves worse. Below ~700px the canvas degrades to regions as sections — a 2D canvas
   on a phone would be worse than the grid it replaced.
2. **The review screen moved to `/:domain/review`** (was `/:domain/map`, which would now
   name the wrong thing). It generates the map, and owns accept/dismiss plus text inputs
   for the axis and region names — the model gets one attempt at those, so correcting
   them by hand has to be possible.
3. **A curated ghost inherits its hole.** Save a dataset whose slug matches a ghost and
   it takes that ghost's exact position, so a field you built *because* you saw the gap
   appears where the gap was.
4. **Regions are map-only, deliberately.** They are not a second taxonomy competing with
   `subtopics` — no filtering by region, no region on the dataset card. Promoting them
   later is additive if they earn it.

### The map became read-only (2026-08-04, third pass)

Cards were draggable, macOS-desktop style: you moved one, it pinned, the layout worked
around it, and the next review was told you'd placed it. That went, along with "Tidy
up" and the whole notion of a stored position.

The reasoning is that a position was never really the user's to assert. Where a field
sits is *derived* — from which region it's in, and from a layout that packs its tile.
Storing a chosen position made the map two things at once: what the review thinks, and
what you dragged. Now it is only the first, and moving a field means changing which
region it belongs to — a statement about the world, not a nudge of a pixel.

The simplifications that fell out are the tell that this was the right cut. `Placement`
went from `{regionId, x, y, pinned}` to `{regionId}`. The collision-relaxation pass went
entirely: the flow inside a tile is already collision-free, and nothing can be anywhere
else. `nearestFreeSpot`, `regionAt`, `regionInner`, the drop handling, and the map's
placement-writing endpoint all went with it, along with the prompt block that fed
user-placements back to the review. Older stored maps still carry `x`/`y`/`pinned`; they
are simply ignored.

### Editing moved to the thing being edited (same day)

The shelf had an edit mode (`?edit=1`) that turned every card into a rename input with a
delete button. It's gone. A field's name and description are now edited on that field's
own page, behind a pen button where the shelf's "+" sits — renaming *Cars* is a decision
you make looking at the cars, not at a card in a grid. Deleting moved there too, for the
same reason and because otherwise it would have had nowhere left to live.

The nav bar lost its "New dataset" and "Edit datasets" buttons in the same move, leaving
it a path and nothing else. Actions sit next to the thing they act on: "+" above the map,
a pen inside the field.

### The escape hatch (added 2026-08-04, on first real use)

A map's axes and regions are settled by its first draw, and nothing else can change
them wholesale. That is the right default and would be a trap without a way out — a
first draw that picked poor axes would be permanent. So the review screen carries
**Redraw from scratch**: it discards the stored map and starts over, losing the regions
and every position (datasets are untouched). Confirmed before it runs, because
everything you've dragged goes with it.

The general shape of the rule: *settled by default, replaceable on purpose, never
replaceable by accident.*

### Legibility (2026-08-04, after the first real map)

The first generated map was good and unreadable — cards carried a title, a description
and an item count, and they overlapped. Both fixed, and the second one is the reason
the first mattered less than it looked:

- **A card is its field's name and nothing else.** The map's job is to show where things
  sit and what isn't there yet; the detail is one click away, and on hover. Card width
  follows the length of the name, so the map reads as pills rather than a grid of equal
  boxes with truncated text in them.
- **Cards never overlap** — a label you can't read is worse than a badly-placed one.
  Positions are seeded per region, then relaxed until nothing intersects. Dropping a card
  settles it into the nearest free gap rather than on top of a field, and the *rest of
  the map never moves* when you do it: searching outward from the drop point beats
  shoving the neighbours aside.
- **Two independent levers for "fit everything in".** Cards shrink (smaller fractions —
  the only thing that stops collisions, since positions are fractional) and the canvas
  grows taller (more pixels — the only thing that keeps a shrunken card readable).
  Verified clean from 19 to 200 fields.

### Regions tile the canvas (2026-08-04, second pass)

Fixing the cards left the *regions* wrong: they were drawn as bounding boxes around
wherever their cards happened to land, so they sprawled, overlapped each other, and
left dead space between them. A region defined by its contents can't do anything else.

Inverted, and this is the structural fix rather than a tuning one: **the canvas is
partitioned into one rectangle per region, and cards are placed inside.** Regions can
no longer overlap or leave gaps — not because the numbers were tuned until they didn't,
but because a partition has no way to. Cards are confined to their own tile, which is
what makes cross-region overlap impossible too.

The partition is a **spatial k-d split, not a treemap**. A plain treemap sorted by size
tessellates beautifully and destroys the meaning of position — which is the entire
reason this map exists. So each split cuts the *longer* side (tiles stay squarish rather
than becoming slivers) and sorts the regions along that side by their **semantic**
coordinate before dividing. Left still means what the x-axis says; up still means what
the y-axis says. Tile area is proportional to what each region has to hold, so nine
fields get room for nine and one field doesn't sprawl.

Inside a tile, cards **flow like words in a paragraph** — left to right, wrapping, the
block centred. A flow rather than a scatter, because "no blank spaces" applies at the
card level too. A binary search picks the largest card scale at which every region's
cards actually flow inside its tile: whether a set of pills fits a rectangle depends on
how they wrap, and no closed form predicts it.

### What testing caught that looking wouldn't

Each of these was invisible on a small map and fatal on a full one. They're recorded
because the pattern is the point — geometry that "looks fine" on the case in front of
you is not evidence.

- A constant pull toward region centres reached equilibrium *with* overlap: 26 fields in
  one region never came apart. It anneals to zero now — cohesion arranges, legibility
  decides.
- The relaxation exited after the edge-clamp pass, so a clamp that pushed a card into
  its neighbour was never re-checked. A layout that had stopped, not settled.
- A full row deadlocked: the horizontal deficit stays the *smaller* one and keeps getting
  chosen even when every card in the row is jammed against the wall. No pair can detect
  it — the jam lives in the chain of cards between it and the edge — so it needs a
  periodic all-vertical pass to break.

Verified across seven shapes (lopsided, many-small, single, empty-region-among-full,
70 fields): tiles never overlap, cover the canvas with no gaps, no point falls in two
tiles, no cards overlap, every card sits inside its own region, and the whole thing is
byte-identical on a re-run.

### Known limits

- **The digital world's axes are a harder call than the physical world's.** *Held →
  inhabited* is crisp for objects; the digital equivalent is genuinely debatable. The
  axes are editable text, and a full redraw is available, for exactly this reason.
- **A first draw is the largest single call the app makes**, and it grows with the
  shelf: a summary, missing fields with rationales, boundary issues, thin fields, two
  axes, every region, and one assignment per field — all in one response. Its timeout
  scales with the number of fields (`server/src/services/claude.ts`). An eight-dataset
  world takes a few minutes.
- **Layout has no collision detection between cards**, only between regions. A very
  crowded region can overlap its cards; dragging fixes it, and "Tidy up" restores the
  spiral. Worth revisiting if regions routinely hold more than a dozen fields.

## Open questions

- **Should a boundary issue be actionable in place?** A one-click rename is easy; merge and
  split are not (items would need reassigning). Deferred until it's clear these get acted
  on often enough to be worth automating.
- **Cross-world review.** Some fields genuinely straddle physical and digital (typography,
  motion graphics, industrial design that ships software). Today each review sees one world
  and can't say "this belongs in the other one." Worth revisiting once both worlds are
  well populated.
