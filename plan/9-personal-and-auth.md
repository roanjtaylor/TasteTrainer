# The personal world, and the wall around everything

> **UI →** this doc owns the sign-in screen, the third card on the domain gate, the
> `/personal/new` form, and the builder tools inside a personal dataset. Everything else a
> personal dataset shows — gallery, filters — is the existing screen, unchanged (`6-ui.md`).

**Purpose**

`ethos.md` is about exposure to the best work humanity has made, and the first two worlds
serve that: they are *objective* — what exists, researched by Claude, audited for blind
spots. But taste isn't only trained on the canon. It's also formed by the particular books,
films, records and family moments that happened to *you* — things that are in no corpus,
that no model can find, and that have no public address to link to.

This doc adds that **subjective** half, and — because it puts family photos on a server —
finally closes the app, which until now anyone with the URL could read *and edit*.

**The core decision(s)**
1. Is the personal side a separate feature, or a third world?
2. Who builds a personal dataset — Claude, or you?
3. Where do your files live, given every other image is "URL only"?
4. What is behind the wall, and who gets through it?

---

## Recommended default (all four built, 2026-09-17)

### 1. A third world, not a separate feature

`Domain` becomes `physical | digital | personal`. A personal dataset is an ordinary
`Dataset` of ordinary `Item`s — same fields, same subtopic and era axes, same Elo.

The alternative was a parallel "playlists" feature with its own shape. It was rejected
because the whole request was to browse personal things *the same way* as the objective
world; a second shape means a second gallery, filter page, ranker and leaderboard, all to
be kept in step forever. One shape means personal datasets got all of those for free, and
the code that draws them never learns they're different.

The only thing that changes per-world is wording: the item form asks for *author /
director / artist* instead of *creator*, and *why it matters to you* instead of *why it's
great* — the wrong question to ask of a family photo. The link field (`url`, otherwise
digital-only) is offered too, for where a thing lives (Spotify, Letterboxd, Goodreads).

### 2. Built by hand — Claude stays out

Nothing in this world is knowable from outside your life, so there is nothing to research
and nothing to audit. `isCuratedDomain()` is the single switch; where it is false:

- **New dataset** is one short form (topic, description, optional subtopics) that creates
  an *empty* dataset — not the map → research → review flow.
- **Adding happens inside the dataset**, where you can watch it take shape: **+ Add item**
  (a blank card, opened for editing) and **Upload files** (a batch: each file becomes an
  item named after it, saved in one write; details are filled in afterwards by clicking the
  card — a form per photo up front is how a 200-photo import never gets finished).
- **Edit dataset** keeps the structure editable for good — rename, re-describe, add /
  rename / remove subtopics (a rename carries its items with it), delete. The researched
  worlds rely on Claude and the field-map review for this; a hand-built collection has no
  such author and changes the way real shelves do.
- Items can be **deleted** (the researched worlds still can't — unchanged on purpose).
- No "Review" sweep, no world review, no map: the shelf is always the plain grid.

The image *search* picker is still offered — it's the fastest way to get a book cover or a
film poster — alongside paste-a-URL and upload.

### 3. Your files: a private bucket, served as expiring links

`2-data.md`'s "URL only, never downloaded" holds because every other image has a public
address. A family photo doesn't and mustn't, so this is the exception:

- Files go to a **private** Supabase Storage bucket (`taste-personal`) with **no storage
  policies at all** — only the server's service-role key can touch it.
- Upload is **direct browser → Storage** with a single-use token the server issues, so
  multi-megabyte photos never pass through (or get limited by) the small API server.
- The database stores a permanent reference (`storage://taste-personal/<path>`); every
  read swaps it for a **signed URL** valid 7 days, and every write swaps it back. That
  conversion lives in one module (`server/src/services/personalFiles.ts`) at the one read
  path and one write path in `storage.ts` — so the rest of the app goes on treating
  `image` as a plain URL. A signed link must never be what's stored: it would work for a
  week and then break for good.
- A file belongs to exactly one item, so when a save leaves nothing pointing at it (item
  deleted, image swapped, dataset deleted) the server deletes it — after the save
  succeeds, never before.
- **Images only** for now (JPEG/PNG/WebP/GIF/AVIF, 25 MB): an item is drawn by an `<img>`.

### 4. One wall, in front of the personal world only, enforced by the server

Only the personal world is sensitive — private uploads, family photos. The physical and
digital worlds are researched, public-domain knowledge, and were never meant to be behind
a login; narrowed to just the personal world on 2026-09-18 (`plan/README.md`).

- **Supabase Auth, email + password.** The web app holds the session and sends its access
  token as a Bearer header on every API request when there is one. The server decodes it
  opportunistically (`attachUser`, mounted on every `/api` route) but only *requires* it
  (`requireAuth`) where personal content is at stake: the files router outright (uploads
  only ever serve the personal world), and inline in `routes/datasets.ts` wherever the
  dataset in play is `domain === 'personal'` — reads, writes and the unscoped list (which
  filters personal entries out for a signed-out caller). The sign-in screen in the browser
  is only the polite front — a wall enforced there alone is a curtain.
- **`ALLOWED_EMAILS`.** The Curiosity Supabase project is shared with other personal
  projects, and anyone can create an account in a Supabase project using its public key —
  so "is signed in" is not "is me". The allowlist closes that gap, which is also why the
  sign-in screen can safely offer "create your account": a stranger who signs up has an
  account and nothing else.
- **The client gates the same way.** `PersonalGate` (`web/src/lib/auth.tsx`) wraps the
  routed app and shows the sign-in screen in place of the page whenever the current URL is
  under `/personal`, and renders straight through everywhere else — so the physical and
  digital worlds work without ever creating a session.
- **Sign-out clears the client read cache** — it keeps whole datasets in localStorage, and
  would otherwise go on painting them for whoever opens the browser next.

---

## Open questions

- **Other media.** Video and audio for memories/music need a player in `Photo` and a
  `mediaKind` on the item — deferred until images prove the shape.
- **Era for photos.** `year` could be pre-filled from EXIF on upload. Left manual for now:
  a file's modified-date is wrong for anything downloaded (covers, posters).
- **Cross-world ranking** (your books vs. the canon's) is the same "scope picker" extension
  `5-comparison.md` already defers.
