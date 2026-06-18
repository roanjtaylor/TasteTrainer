# Setup — the skeleton

**Purpose**
How the app is built and run. TasteTrainer is a webapp you open in your browser on your own machine (`localhost`); a small local server does the work the browser can't — talking to Claude and reading/writing files on your disk. Nothing is deployed to the cloud; nothing leaves your machine except the calls to Claude and to image sources.

**The core decision(s)**
1. **Language / stack** — what we write the app in.
2. **Shape** — one program, or a frontend + a backend.
3. **Where data lives** — a folder of plain files on disk vs a database.

**Recommended default**
- **TypeScript everywhere.** It's the most widely used language ecosystem, so AI assistance (including mine) is at its best on it, and one language covers the whole app. Frontend in **React + Vite**, backend in **Node + Express**.
- **Two small parts in one project:** a `web/` frontend (the UI you see) and a `server/` backend (calls Claude, writes files). The backend is required because browsers can't safely write to your disk or hold credentials.
- **Plain files on disk, not a database.** A `data/` folder holds one JSON file per dataset plus downloaded images. Simple, inspectable, portable, and matches "stored locally automatically." A database is overkill for a personal tool.
- **One command to run both** (frontend + backend together) during development.

*Why:* maximises AI-assist quality, keeps it to one language, and stays dead-simple and local-first.

**Open questions**
- Happy with TypeScript + React, or do you want to consider Python for the backend (second language, but also very AI-friendly)?
- Any preference on look-and-feel tooling (e.g. Tailwind for fast styling vs plain CSS)? Can defer.
- OK that running it means starting a small local server each time (we can make this a single click/command)?
