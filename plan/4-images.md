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
- Website/digital-design domains → screenshot capture + Wayback Machine, planned in their own doc when the time comes.
- Stale/dead-link detection & repair (beyond manual re-pick).
