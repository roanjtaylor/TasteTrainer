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
  (the most likely English Wikipedia article title, used to fetch an image).
- Be accurate. If unsure of a year, give your best estimate rather than null, unless truly unknown.

## (e) Web-search policy
- Use web search when recency or completeness is genuinely in doubt (cutting-edge or
  fast-moving topics). For well-settled "best of" topics (e.g. 1990s watches, classic cars),
  answer from your own knowledge — it is usually sufficient and faster.
