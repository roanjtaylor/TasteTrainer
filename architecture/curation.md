# Curation — making a dataset with AI

**Purpose**
The heart of the tool. You pick a topic; Claude does the research grunt-work (finding the names of the best work and why they're great); you review and tidy before saving. The model does the hard part so you can build great reference sets in minutes instead of hours — your fast-track to exposure.

**The core decision(s)**
1. **The flow** — how a dataset gets created, start to finish.
2. **What Claude returns** — research output, not images (images are handled in `images.md`).
3. **How the app talks to Claude** — which access path.
4. **What you can do after** — editing/extending/deleting.

**Recommended default**

**Flow (topic → research → review → save):**
1. You type a **topic** and roughly **how many** items (e.g. "20 most iconic chairs").
2. The backend asks **Claude** to return a clean list of items — for each: `name`, a short `description` of why it's great, and the likely **Wikipedia title** (used later to fetch the image).
3. The app fetches an image per item (see `images.md`) and shows everything on a **review screen** — a grid of proposed items.
4. You **edit freely before saving**: deselect ones you don't want, fix text, swap images, or "ask Claude for more". Nothing is saved until you say so.
5. **Save** writes the dataset to disk.

**After saving (full CRUD):** list all datasets, open one to rename/edit/add/delete items or re-fetch images, and delete whole datasets. "Add items" can be manual or "ask Claude for N more".

**How it talks to Claude:** the **Claude Agent SDK using your Pro/Max subscription** (the same login Claude Code uses) — no separate pay-per-use API key, no extra cost. It can also web-search when unsure, but for famous "best of" topics the model's own knowledge + Wikipedia titles usually suffice.

*Why:* review-before-save keeps you in control of taste (the model proposes, you decide), and the subscription path keeps it free.

**Open questions**
- Is **review-before-save** (model proposes a full set, you prune) the right default — or would you rather build sets more incrementally (add a few at a time)?
- For ambiguous/cutting-edge topics, should Claude **web-search by default**, or only when you ask (slower/maybe costs subscription quota)?
- Any fields you want Claude to always fill beyond name + description (e.g. year, designer)? (Ties to `data.md`.)
- Confirm you're logged into Claude on this machine (Claude Code / `claude`), so the subscription path works without an API key.
