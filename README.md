# TasteTrainer

A personal, local-first "bicycle for the mind": deliberately expose yourself to the best work in a field, train your eye through forced 1v1 judgement, and build defined taste.

Built from the decision docs in [`/plan`](./plan) — that folder is the canonical spec; this app executes it.

## What it does

1. **Curate** — name a field; Claude maps its subtopics and researches the defining work (countering popularity bias — see `plan/3-curation.md`). You review and edit before saving.
2. **Browse** — explore a dataset as a gallery, filtered by subtopic and/or era. Ask "what's missing?" to find coverage gaps.
3. **Rank** — pick the better of two items (Elo). A scoped leaderboard emerges; a size-based target tells you when a session is "done".

Datasets are plain JSON files on disk under `data/` (one per field). Images are stored as **URLs only**, never downloaded.

## Stack

TypeScript everywhere. **Frontend:** React + Vite + Tailwind v4. **Backend:** Node + Express (run with `tsx`). Shared types in [`/shared`](./shared). See `plan/1-setup.md`.

```
shared/   shared TypeScript types (the data model)
server/   Express API: storage, Claude curation, image sourcing, Elo
web/      React app: Datasets home, Curate flow, Dataset view
data/     created at runtime — your datasets + comparison results (git-ignored)
plan/     the decision docs this app is built from
```

## Prerequisites

- **Node 20+** (Node 22 recommended — global `fetch` is used).
- **Claude credentials.** The backend calls Claude via the **Claude Agent SDK**. It uses whatever credentials your environment already has:
  - If you're logged into Claude Code on this machine, the SDK uses that login.
  - Otherwise set `ANTHROPIC_API_KEY` in your environment before starting the server.
  - No key is hardcoded anywhere. (Note: per Anthropic's terms, the Agent SDK is intended for first-party/personal use with your own credentials — which is exactly this tool's purpose.)

## Run it

```bash
npm install        # installs root + server + web (npm workspaces)
npm run dev        # starts the API (:5174) and the web app (:5173) together
```

Then open **http://localhost:5173**. The web app proxies `/api` to the backend automatically.

To run the pieces separately:

```bash
npm run dev -w server
npm run dev -w web
```

## Tuning curation

The AI's curation behaviour is **not a blackbox** — it lives in one editable file:

```
server/src/prompts/curation-rules.md
```

Edit it to refine coverage, anti-bias, dedup, field-filling, or web-search policy. Changes take effect on the next call (the file is re-read each time) — no restart, no code change. See `plan/3-curation.md`.

## Notes / known edges

- The image **swap picker** uses an unofficial DuckDuckGo endpoint (chosen for cleaner results, no API key). If it ever stops returning results, paste an image URL directly in the picker — it's a small, contained fix (`plan/4-images.md`).
- UI is intentionally a **simple MVP** in the gallery aesthetic (warm beige, pill nav). Deeper polish — and website/digital-design datasets — are deferred per the plan.
