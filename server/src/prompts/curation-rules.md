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

- **Field-filling in the digital world:** every item still fills every field, but `wikipediaTitle`
  is replaced by `url` — the canonical site/product address (e.g. "https://stripe.com"),
  used to capture a screenshot rather than fetch a photo. `year` means *the year THIS
  SPECIFIC design/snapshot represents* — not today's look, and not when the company was
  founded — so the same product at two different years is two different items, correctly.

- **Picking the representative year:** choose the year a design was at its most
  characteristic/influential for the era it's illustrating, favouring a year with a
  reasonable chance of being archived (avoid the last few months — snapshots may not exist
  yet; very early years of the web, pre-1996 or so, are also thinly archived — 1996+ is
  much safer ground for "earliest era" items). `brand` is the company/product; `creator` is
  the named designer/design lead if one is actually known and notable, "" otherwise (most
  digital work has no single credited designer the way a chair or a watch does — don't
  invent one).
