# Curation rules

This is the single, editable rulebook the AI follows when building datasets.
It is plain text on purpose (3-curation.md): edit it to refine curation over time —
no code change needed — and read it to understand exactly what the model is told.

The goal of every dataset is to show the **objective reality of a field**: the key
work that actually defines it, not just the famous corners already widely recognised.
Core principle: **find what you don't know that you don't know.**

## (a) Field-mapping / coverage
- Before listing items, map the field's real dimensions: the major makers/brands,
  schools/movements, eras, sub-genres, and regions.
- Deliberately draw items ACROSS those dimensions. Aim for representativeness of the
  whole field, not a popularity ranking of its top few names.
- Coverage must span brands/movements/eras WITHIN each subtopic, not only across subtopics.

## (a2) Subtopic count — minimum necessary, not a fixed number
- Subtopics are the field's **core themes/areas** — the smallest set of categories that
  together cover the WHOLE field with little overlap. Use as **few or as many as the field
  genuinely needs**, never a fixed target.
- Some fields split cleanly into just 2–3 (e.g. "analogue vs digital"); others span many
  (e.g. distinct artistic periods across centuries). Let the field's real structure decide.
- Each subtopic must be **distinct and necessary**: if two could merge without losing a real
  distinction, merge them; if one theme is actually two different things, split it. Do not
  pad with filler categories, and do not cram unrelated areas together to hit a round number.

## (b) Anti-bias
- "Best-selling" / "most-famous" is NOT the same as "most-defining". Include the work
  that *shaped* the field even when it is less mainstream.
- Do not over-index on one dominant name. If one brand/maker/movement would dominate the
  set, deliberately surface its peers and rivals (e.g. for cars: not only Mercedes — also
  BMW, Citroën, Honda, Lancia, and the movements they represent).
- Prefer global and historical breadth over the recent and the locally famous.

## (c) Dedup on expansion
- When asked for more items, you are given the existing items. Never repeat them
  (match on name + brand, case-insensitively).
- Prefer filling UNDER-represented areas of the current set. Each expansion should widen
  coverage, not deepen an already-crowded cluster.

## (d) Field-filling
- Fill EVERY field for every item so the user can sanity-check a row at a glance:
  name, description (one or two sentences on *why it's great / defining*), year,
  brand (company/maker — "" if none, e.g. a painting), creator (the individual designer/
  artist/architect — "" if not applicable), definingFact (a one-sentence notable fact),
  subtopic (must be exactly one of the dataset's canonical subtopics), and wikipediaTitle
  (the most likely English Wikipedia article title, used to fetch an image — replaced by
  `url` in the digital world, see (f)).
- Be accurate. If unsure of a year, give your best estimate rather than null, unless truly unknown.

## (e) Web-search policy
- Use web search when recency or completeness is genuinely in doubt (cutting-edge or
  fast-moving topics). For well-settled "best of" topics (e.g. 1990s watches, classic cars),
  answer from your own knowledge — it is usually sufficient and faster.

## (f) The digital world — different axes, different field-filling (7-software-design.md)
Every prompt tells you which world the field belongs to. When it is THE DIGITAL WORLD, the
field lives on a screen — websites, apps, product UI, motion and graphics — not in physical
space, so adjust (a) and (d) accordingly; (b) and (c) apply as-is.

- **Subtopics = functional categories, not brands.** A digital field's subtopics are what
  the work actually DOES — e.g. for "Booking systems": Flight search, Seat/room
  selection, Checkout & confirmation. For "Developer tools": Text editors, Terminals,
  Debuggers, Version control UIs. Not "Google vs Microsoft" — that's not how digital fields
  divide the way makers divide a physical one.

- **The primary axis of coverage is TIME, not brand.** This is the single most important
  difference from curating the physical world. The point of a digital dataset is to show a category's
  **design evolution**, era by era — so within each subtopic, items must be spread across the
  field's WHOLE plausible design history, not clustered in the present:
  - Web-based software: roughly mid-1990s (Web 1.0) → today.
  - Desktop/OS software: roughly 1970s–80s (early GUIs) → today.
  - Mobile apps: roughly 2007 (iPhone/App Store) → today.
  Distribute the requested item count roughly EVENLY across that span per subtopic. If asked
  for 12 items in one subtopic, that should read as 3–4 distinct eras with 3–4 examples each,
  not 10 current products and 2 old ones. Do not default to the present just because it's
  most familiar — the historical eras are the actual point of a digital dataset.

- **Reuse the same iconic product across multiple eras — this is the ideal case, not a
  duplicate.** A product with a long, well-documented redesign history (e.g. Amazon, Google
  Search, Craigslist, the Mac Finder) makes the BEST teaching material precisely because you
  can show it at several points in its life and see the design language change while the
  purpose stays fixed. Prefer this over introducing a different, more obscure product for
  every era. It also has a practical benefit: famous, long-lived sites are far more
  thoroughly archived than obscure ones, so their older designs are much more likely to
  actually be found and screenshotted successfully. When a single product can't span the
  whole history (it didn't exist yet), pick that era's most representative product instead.

- **Field-filling in the digital world:** every item still fills every field, and adds four
  image-sourcing fields: `imageKind`, `url`, `wikipediaTitle` and `imageQuery`. `year` means
  *the year THIS SPECIFIC design/snapshot represents* — not today's look, and not when the
  company was founded — so the same product at two different years is two different items,
  correctly.

- **Not everything in the digital world is a website — say which kind it is.** This is the
  most important call you make for whether a real picture can be found at all. A website's
  past design is recovered from the web archive; an operating system shell, a 1970s terminal
  screen, an icon set or a typeface cannot be, and has to be found as an existing image
  instead. Set `imageKind` honestly:
  - `archived-site` — a website, showing a PAST design. Give `url`.
  - `live-site` — a website, showing its PRESENT design. Give `url`.
  - `software-ui` — software that is not a website: OS shells, desktop apps, terminals,
    anything pre-web. Leave `url` empty.
  - `artifact` — a graphic work: icons, typefaces, logos, posters, motion stills. Leave
    `url` empty.

- **`url` is for real websites only, and is NEVER a Wikipedia link.** If the thing was never
  a website, leave `url` empty and pick `software-ui` or `artifact`. Putting an article url
  here does not produce a picture of the work — it produces a picture of the *encyclopaedia
  page about* the work, which is worse than no image, because it looks like a success.
  If you are tempted to write a Wikipedia url, that is the signal the item is not a site.

- **Always give `wikipediaTitle` and `imageQuery`, for every digital item.** They are what a
  picture is found with when a capture fails or is impossible, so they matter most for
  exactly the historic work that is hardest to illustrate. `imageQuery` should be a phrase
  you would actually type into an image search to see this specific thing — "Mac OS System 7
  Finder desktop screenshot", not "System 7". An item's own name is often too terse
  ("Search", "Forms") to find anything with.

- **Prefer the snapshot that actually survives.** When two products could represent the
  same early era, pick the older, simpler, server-rendered one. Pages from before roughly
  2010 were mostly static HTML, so an archived copy renders faithfully; a JS-heavy app of
  the same vintage re-fetches from the live web on replay and quietly renders as TODAY.
  A slightly less famous product that archives honestly beats a famous one that lies.

- **Picking the representative year:** choose the year a design was at its most
  characteristic/influential for the era it's illustrating, favouring a year with a
  reasonable chance of being archived (avoid the last few months — snapshots may not exist
  yet; very early years of the web, pre-1996 or so, are also thinly archived — 1996+ is
  much safer ground for "earliest era" items). `brand` is the company/product; `creator` is
  the named designer/design lead if one is actually known and notable, "" otherwise (most
  digital work has no single credited designer the way a chair or a watch does — don't
  invent one).

## (g) The field map — auditing the WHOLE world, not one field
Sections (a)–(f) govern what goes INSIDE a field. This section governs the level above:
given every field the user has built in one world, is that collection a good map of the
world? Apply (a)'s field-mapping and (b)'s anti-bias one level up.

- **Map the world first, then compare.** Before judging what's there, work out how a
  knowledgeable person would actually divide this world into fields. Then read the user's
  fields against that map. The output is the difference between the two.

- **Missing fields are the point.** Name the fields of this world the user has NO dataset
  for. Prioritise the ones they are least likely to have thought of themselves — a map
  built one topic at a time inherits the blind spots of whoever named the topics. An
  obvious omission is worth one line; a field the user probably doesn't know is a field
  is worth naming clearly and explaining. Do not pad: a small number of real gaps beats a
  long list of near-duplicates of what already exists.

- **Judge the boundaries, not just the coverage.** A field can be drawn wrong: two
  datasets that are really one field (merge), one dataset holding two unrelated fields
  that would each deserve their own subtopics and eras (split), or a name that
  misdescribes what it actually contains (rename). Only raise a boundary issue when the
  current shape genuinely loses something — not as a matter of taste in naming.

- **Say which existing fields are thin.** Using only the item counts, subtopic lists, and
  year spans given, flag fields that look under-built or skewed (e.g. many items but two
  subtopics; a century-spanning field whose items all sit in one decade). Be concrete
  about what looks wrong. You are not being given the items, so do not guess at specific
  missing works here — that is the per-field sweep's job.

- **The summary teaches.** `mapSummary` is one paragraph on how this world really divides
  and what a complete map would look like. Write it for someone building their sense of
  the whole world, not as a recap of what they already have.

### (g2) The spatial map — axes and regions
The world is also drawn as a 2D map, so the same review decides where things sit. You
choose the MEANING; the app turns it into pixels. Never return canvas coordinates.

- **Two axes, chosen once for the whole world.** Each is a continuous dimension with a
  named low and high end, and every field in the world should sit somewhere sensible on
  both. Good axes are concrete and physical enough to place a thing without arguing —
  e.g. for objects, *held in the hand → inhabited* and *practical → expressive*. Bad axes
  are ones you can't confidently place a field on (*"important → unimportant"*), or that
  really only apply to a corner of the world.
- **Regions are few and genuinely distinct.** Aim for the smallest set that covers the
  world with little overlap — the same rule as subtopics in (a2). A region should be
  recognisable as a part of the world in its own right, not a bucket for leftovers. Every
  field, and every field you propose as missing, belongs to exactly one.
- **Region positions are 0–1 on the two axes**, and they should genuinely differ: if two
  regions would sit in the same place, they probably want merging. Spread them out — a map
  where everything clusters in one corner teaches nothing.
- **An existing map is SETTLED.** When you are given the world's current axes and regions,
  do not re-derive, rename, reorder or re-position them. Place the unassigned fields into
  the regions that exist, and raise anything else as a suggestion for the user to accept.
  This is the difference between a map someone can learn and one that changes under them.
- **Suggest sparingly, and only what's mechanical.** A handful at most, each with a real
  reason: a genuinely missing region, a field in the wrong region, a region whose name
  misdescribes it. Bigger structural change belongs in `boundaryIssues`, not here.
