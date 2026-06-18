# Images — a real picture for every item

**Purpose**
This is the genuinely hard part. Claude can reliably tell you *what* the best 50 watches are; getting an actual, correct *photograph* of each is the challenge — and since this is a visual taste tool, the image is the whole point. We need a default source that "just works" for famous objects, plus an easy escape hatch when the default picks a poor image.

**The core decision(s)**
1. **Default image source** — where the picture for each item comes from automatically.
2. **The alternative picker** — how you swap in a better image when the default is wrong/ugly.
3. ~~Store the image, or just link to it.~~ **Decided in `data.md`: link only (store a URL, never download).**

**Recommended default**
- **Default source: Wikimedia Commons / Wikipedia.** Free, stable, hotlink-friendly, and excellent for exactly the "best of humanity" domains — cars, watches, architecture, furniture, artwork. Claude gives the Wikipedia title; the backend resolves that page's lead-image **URL** and stores it in the item's single `image` field.
- **Alternative picker (your confirmed ask):** an edit control that shows the **first 9 Google image results** for the item's name in a 3×3 grid. Click one to set the item's `image` URL to that result. Uses Google's official **Custom Search JSON API in image mode** (free ~100 queries/day; one-time setup of a key + search-engine ID).
- **Link, don't download (your call in `data.md`):** we keep the chosen image's **web address only** — no local copies. Tiny storage, and a dead image is fixed by pasting a new URL.
- If Wikimedia has no usable image, flag the item "needs image" so you can use the picker.

*Why:* Wikimedia carries the MVP for free with minimal fuss; the Google 3×3 picker gives you full control for the cases it misses; URL-only keeps storage trivial and images easy to refresh.

**Open questions**
- Good with **Google Custom Search** for the 9-image picker (needs a free one-time key + search-engine ID — I'll write the steps)? Or prefer a different image search so there's no setup?
- For the MVP, are the domains mostly **physical design + art** (where Wikimedia shines)? If you care a lot about **website/digital design**, those need screenshots — a different mechanism we'd plan separately.
- A URL-only approach means an item shows a broken image if a link later dies — fine to handle by **re-running the picker** to repaste a fresh URL (rather than any local backup)?
- Any concern about image **licensing/credit**, or is "personal use, just the image URL" fine?
