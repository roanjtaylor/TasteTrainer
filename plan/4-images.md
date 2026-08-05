# Images — a real picture for every item

> **UI →** the **3×3 image picker** lives *inside* the Curate flow review grid (`3-curation.md` / `6-ui.md`) — it's how you swap an item's image. The global shell/visual language lives in `6-ui.md`.

**Purpose**
This is the genuinely hard part. Claude can reliably tell you *what* the best 50 watches are; getting an actual, correct *photograph* of each is the challenge — and since this is a visual taste tool, the image is the whole point. We need a default source that "just works" for famous objects, plus an easy escape hatch when the default picks a poor image.

**The core decision(s)**
1. **Default image source** — where the picture for each item comes from automatically.
2. **The alternative picker** — how you swap in a better image when the default is wrong/ugly.
3. ~~Store the image, or just link to it.~~ **Decided in `2-data.md`: link only (store a URL, never download).**

**Recommended default**
- **Default source: Wikimedia Commons / Wikipedia.** Free, stable, hotlink-friendly, and excellent for exactly the "best of humanity" domains — cars, watches, architecture, furniture, artwork. Claude gives the Wikipedia title; the backend resolves that page's lead-image **URL** and stores it in the item's single `image` field.
- **Alternative picker (your confirmed ask):** an edit control that shows the **first 9 DuckDuckGo image results** for the item's name in a 3×3 grid. Click one to set the item's `image` URL to that result. DuckDuckGo gives **cleaner results than Google** (no ad/shopping clutter) and needs **no API key or setup** — the backend hits DuckDuckGo's image-search endpoint directly. Trade-off: it's an *unofficial* endpoint (no formal API), so it could change and need a small fix someday; for a personal local tool that's an acceptable, low-stakes risk.
- **Link, don't download (your call in `2-data.md`):** we keep the chosen image's **web address only** — no local copies. Tiny storage, and a dead image is fixed by pasting a new URL.
- If Wikimedia has no usable image, flag the item "needs image" so you can use the picker.

*Why:* Wikimedia carries the MVP for free with minimal fuss; the DuckDuckGo 3×3 picker gives you full control for the cases it misses (better results, zero setup); URL-only keeps storage trivial and images easy to refresh.

**Resolved (2026-06-18)**
1. **DuckDuckGo confirmed** — chosen for better images than Google. The unofficial-endpoint risk is accepted: this is an internal/personal tool, so if it breaks it's fine to hack a fix. No formal-API fallback needed for now.
2. **Domains are physical design + art for the MVP** (watches, cars, paintings). **Website/digital design is deferred** until the MVP is proven — screenshot tech / Wayback Machine is explicitly out of scope for now and will be planned separately later.
3. **URL-only confirmed** — fine for now. A dead link is handled by re-running the picker to paste a fresh URL; no local backup. Stale-link handling is deliberately deferred (a good CS exercise to tackle later if it actually becomes a problem).
4. **Licensing: not a concern** — personal use, image URL only.

**Deferred for later (post-MVP)**
- Website/digital-design domains → screenshot capture + Wayback Machine — now planned in [7-software-design.md](7-software-design.md).
- Stale/dead-link detection & repair (beyond manual re-pick).

---

## Amended (2026-08-04)

- **The picker has a second source, and it's the one that keeps it working.** Decision 1
  accepted the unofficial-endpoint risk without a fallback; in practice the DuckDuckGo
  scrape breaks often enough that the picker falls through to the **official Wikimedia
  Commons search API** (`services/images.ts`) whenever it returns nothing. Same 3×3 grid,
  same interaction — the user never sees which source answered. The accepted risk is
  therefore "occasionally worse results", not "the picker stops working".
- **"Link, don't download" now has one honest exception.** Digital-world screenshots don't
  exist anywhere to link to, so we render them ourselves and upload the PNG to Supabase
  Storage (`7-software-design.md`). The *item* still holds only a URL — the philosophy
  above survives from the data model's point of view — but the bytes are ours, and that is
  a real departure worth naming rather than glossing.
- **A missing image is no longer the only failure worth flagging.** Decision 3's "a dead
  link is handled by re-running the picker" assumed failures are visible. The digital
  pipeline's characteristic failure isn't a broken image — it's a *plausible wrong* one (a
  present-day screenshot standing in for a historical design). Items now carry how their
  image was captured, and a non-period-accurate one is badged in the review grid and the
  gallery. See the same-dated note in `7-software-design.md`.

---

## Amended (2026-08-05) — one default source was never going to be enough

The model above is "a default source that just works, plus an escape hatch when it
doesn't". That holds for the physical world, where Wikimedia genuinely does carry the
MVP. It does not hold for the digital one, and the reason is worth stating here rather
than only in `7-software-design.md`, because it changes what "default source" means.

**Every source available for digital work is high-variance, and none of them fails
loudly.** Wikipedia has the real 1979 VisiCalc screenshot and nothing whatsoever for
Windows 95, System 7, HyperCard or WordPerfect. A Commons search for "Mac OS System 7
desktop" returns 14×16 widget icons — and Commons' own API reports those as 800×914,
because it reports the size you asked for rather than the file you got. The free
screenshot service answers a cold request with a "generating…" placeholder that is a
valid `image/gif`, and ten items had that saved as their picture. So there is no source
to pick and then trust.

The replacement, therefore, is **not a better default — it is competition and scoring.**
Several sources are asked at once, every candidate is measured (dimensions read from the
file header, not from what an API claims), and the best-scoring one wins with its
provenance recorded on the item. Three things this had to learn that a single-source
model never has to:

- **Small is not the same as bad.** The authentic artefact is usually the small one — a
  1984 Macintosh screen was 512×342. Judging historical images by a modern screenshot's
  resolution throws away exactly what we are trying to collect.
- **Provenance outranks resolution.** Ranking on pixels alone gave VisiCalc to a 2025
  blog post, because it was bigger than Wikipedia's genuine screenshot.
- **The 3×3 picker had to learn the same lesson.** It offered digital items nothing but
  Wayback screenshots of a url, so asking it to illustrate a 1979 spreadsheet produced an
  empty grid. It now runs the same cascade curation runs, labelled by source, so manual
  triage sees everything the pipeline saw.

**Decision 3's deferral is partly retired.** "Stale-link handling is deliberately
deferred" assumed a dead link is the failure mode. The real one is a *live* link to the
wrong picture, so images can now be re-resolved for a field that is already saved —
which is the only way work curated before any of this could benefit from it.
