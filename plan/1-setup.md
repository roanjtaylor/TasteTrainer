# Setup — the skeleton

> **UI →** the overall interface (screen map, design language, styling tooling) lives in `6-ui.md`. This doc is just the skeleton underneath it.

**Purpose**
How the app is built and run. TasteTrainer is a webapp you open in your browser on your own machine (`localhost`); a small local server does the work the browser can't — talking to Claude and reading/writing files on your disk. Nothing is deployed to the cloud; nothing leaves your machine except the calls to Claude and to image sources.

**The core decision(s)**
1. **Language / stack** — what we write the app in.
2. **Shape** — one program, or a frontend + a backend.
3. **Where data lives** — a folder of plain files on disk vs a database.

**Recommended default**
- **TypeScript everywhere.** It's the most widely used language ecosystem, so AI assistance (including mine) is at its best on it, and one language covers the whole app. Frontend in **React + Vite**, backend in **Node + Express**.
- **Two small parts in one project:** a `web/` frontend (the UI you see) and a `server/` backend (calls Claude, writes files). The backend is required because browsers can't safely write to your disk or hold credentials.
- **Plain files on disk, not a database.** A `data/` folder holds one JSON file per dataset (images are **URL-only, not downloaded** — see `2-data.md`/`4-images.md`). Simple, inspectable, portable, and matches "stored locally automatically." A database is overkill for a personal tool.
- **One command to run both** (frontend + backend together) during development.

*Why:* maximises AI-assist quality, keeps it to one language, and stays dead-simple and local-first.

**Resolved (2026-06-18)**
1. **Stack confirmed: TypeScript everywhere** — React + Vite frontend, Node + Express backend, shared types. (Python backend considered and declined — one language is simpler.)
2. **Styling tooling decided in `6-ui.md`: Tailwind CSS + shadcn/ui** (no longer deferred).
3. **Local server each run is fine** — wrapped in one command to start frontend + backend together.

---

## Superseded (2026-08-04): local-first became deployed

Two decisions above no longer describe the built app. Both changed for the same reason —
the tool got shared with other people, which localhost and on-disk files can't support.

- **Storage is Supabase Postgres, not a `data/` folder of JSON.** A dataset is one `jsonb`
  row in `taste_datasets` (plus `taste_rankings` for scores). `data/` still exists on the
  original machine as the pre-migration copy; nothing reads it. The *shape* decided in
  `2-data.md` is unchanged — it's the same JSON, now in a row instead of a file — so this
  is a hosting change, not a data-model one.
- **It runs in the cloud, not only on localhost.** Web on Vercel, API on Render as a
  Docker service (Docker because the digital world's screenshot renderer needs Chromium —
  `7-software-design.md`). `npm run dev` still runs both locally, unchanged.

The knock-on: the backend can no longer borrow a Claude login from the machine it runs on,
which is what the Claude Agent SDK integration relied on. Claude is now reached through a
self-hosted Hugging Face Space proxy — see the same-dated note in `3-curation.md`.

**What this costs:** writes are unauthenticated, so anyone who can reach the API can edit
or delete a dataset. Accepted for now, in the same spirit as the arcade-name rankings
(`5-comparison.md`), but it's a real consequence of leaving localhost, not a non-issue.
