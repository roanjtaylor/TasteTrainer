# Claude as the engine, TasteTrainer as the workspace

**The idea.** Working with Claude Code on a folder: say what you want, watch it work, see a
red/green diff, accept. Do the same for taste data. The "folder" is your worlds and
datasets; the "diff" is a changeset of items and fields; nothing is written until you accept.

TasteTrainer stops being a set of fixed Claude calls and becomes three things: **storage**,
**display**, and **an approval gate**. Claude does everything else.

---

## Status — built 2026-09-20 (slices 1–4; read this first)

Built and tested end to end against a local Space: chat dock, live transcript, tools,
changesets with diff review, apply / conflict / undo, queue, stop, thread history.

**One design change from the plan below: no MCP-over-HTTP.** The Space can't reach a
localhost API, so tools travel over connections the API itself opens: the Space emits a
`tool_request` event on the response stream, the API runs the tool and answers with a
POST to `/api/agent/tool-result`. Works identically on localhost and in production, and
there is no public tool endpoint to secure. (Sections A.1–A.3 and B.1 below describe the
superseded HTTP-MCP design; everything else stands.)

Where things live:
- Space: `src/services/agent.ts`, `src/routes/agent.ts` (`/api/chat` untouched)
- API: `services/agentRun.ts` (run engine + system prompt), `services/agentTools.ts`
  (the tools), `services/changesets.ts` (stage / apply / revert), `routes/chat.ts`
- Shared: `shared/chat.ts` (types + the one reducer both sides fold events with)
- Web: `components/chat/*`, `lib/chat.ts`, `lib/chatView.tsx`
- DB: `supabase/migrations/008_chat.sql` (applied)

Decided: personal-world chat allowed (signed-in only) · no separate notes field
(`description` is the note) · no auto-accept · always review.

Retired 2026-09-20: every fixed review flow. The per-dataset Review button (sweep +
direct request, `/gaps`, `/gap-fill`), the world review screen (`/field-map`,
`/boundary-fix`, map suggestions) and the settings cog (`BrainPanel`, `/api/brain`). The
dock's presets replace them. The only fixed Claude calls left are the new-dataset wizard's.

Map ops — built 2026-09-20. Claude draws and amends a world's map through the same gate:
`propose_draw_map`, `propose_map_changes` (regions, placements, proposed missing fields),
`propose_create_dataset`'s `region`, and `propose_delete_dataset` (empty datasets only —
the last step of a merge). Ops `map.draw | map.region | map.place | map.ghost |
dataset.delete` in `shared/chat.ts`; their meaning in `services/worldMap.ts`
(`applyMapOp`); undo is a whole-map snapshot. The map has no other write path.

Not built yet: presets are hardcoded in `ChatDock.tsx` (not user-editable) ·
no edit-before-accept in the diff (ask Claude to amend, or edit after accepting) ·
vision.

---

## What I found (this changes the plan)

The HF Space is not a thin chat proxy. It runs the **Claude Agent SDK** (v0.1.77) — the
same agent loop as Claude Code — on your subscription. So:

- **Tool use is already possible.** The SDK accepts `mcpServers: { type: 'http', url,
  headers }` (checked in the installed types). The Space just never passes any.
- **Live actions are already half-streamed.** The Space emits `tool` and `sources` SSE
  events today. TasteTrainer's `runJsonOnce` reads only `delta` and throws the rest away —
  that is the black box. Web search is on too; TasteTrainer never shows it.
- **Vision works** via the `attachments` field. The "unwired" note at
  `server/src/services/imageQuality.ts:328` is out of date — it only fails when blocks are
  put in `content`.
- **The Space is shared with IphoneClaude.** Its client (`d_IPhoneClaude/app/src/api.ts:117`)
  is an if/else on event names, so unknown events are ignored. Still: add a new endpoint,
  don't change `/api/chat`.

So no text-protocol workaround (my earlier suggestion). Real tools, real agent loop.

---

## Architecture

```
Browser ── SSE ──► Render API ── SSE ──► HF Space (Agent SDK, subscription)
 chat dock          owns: runs, events,         │
 diff review        changesets, tools           │ MCP over HTTP (tool calls)
                          ▲                     │
                          └─────────────────────┘
```

1. You send a message. The web app attaches the **view context** (world → dataset → item,
   plus active filters) and the chosen model.
2. The API creates a **run** (a job), mints a short-lived run token, and calls the Space's
   new `/api/agent` with the messages, system prompt, and an MCP server entry pointing
   back at the API (`/mcp`, bearer = run token).
3. Claude works: reads data through tools, searches the web, thinks, and **stages** changes
   through `propose_*` tools. Every step streams back as an event.
4. The API stores each event and relays it to the browser. Close the tab and the run
   carries on; reopen and the transcript replays.
5. Staged changes appear as a diff. Accept all, accept some, edit, or discard. Accept is
   the only thing that writes to `taste_datasets`.

**Why the API hosts the tools, not the Space:** the Space stays generic (any of your apps
can bring its own tools the same way), and everything that touches Supabase stays in one
codebase with the validation that already exists.

---

## The tools Claude gets

Read (free rein — no approval needed):

| Tool | Returns |
|---|---|
| `get_view` | What's on your screen right now: world, dataset, open item, filters |
| `list_datasets(domain?)` | The shelf, with counts |
| `get_dataset(id, detail)` | Header, subtopics, eras, items — `compact` inventory or `full` records |
| `search_items(query, datasetId?)` | Matches across one dataset or all |
| `get_item(id)` | One full record |
| `get_world_map(domain)` | Axes, regions, placements |
| `get_rules` | The curation rulebook (`curation-rules.md`) |
| `WebSearch`, `WebFetch` | Already on the Space |

Propose (staged into the run's changeset, never written directly):

| Tool | Op it stages |
|---|---|
| `propose_add_items(datasetId, items[])` | `item.add` |
| `propose_update_item(itemId, patch)` | `item.update` |
| `propose_remove_items(itemIds[], why)` | `item.remove` |
| `propose_move_items(itemIds[], toDatasetId, subtopic)` | `item.move` |
| `propose_update_dataset(datasetId, patch)` | `dataset.update` — description, topic, subtopics, eras |
| `propose_create_dataset(...)` | `dataset.create` |

Each propose tool **validates and answers Claude**: "staged 9 of 10 — 'Dive Watches' is not
a subtopic of this dataset; the options are …". Claude fixes it in the same run. This
replaces the parse-then-hope JSON handling in `services/claude.ts`. It is the one place
structure stays, and it is structure around *writes*, not around *what you may ask*.

Merge/split/rename of fields needs no special flow: it is `dataset.create` + `item.move` +
`dataset.update`, staged as one changeset.

---

## The diff (the approval gate)

A changeset = ordered ops + the dataset versions it was built against.

- **Added** items: green-edged `ItemCard`s. Images resolve in the background through the
  existing `attachImages` pipeline and fill in as they land.
- **Removed** items: red, struck through, with Claude's reason.
- **Updated** fields: old → new, red/green, word-level for long text.
- Per-op checkboxes · Accept selected · Accept all · Discard · edit-before-accept (reuse
  `ItemFields`).
- **Apply** re-checks each dataset's `updatedAt` against the base version. If it moved,
  the affected ops are flagged, not silently overwritten.
- **Undo**: apply stores the prior values; an applied changeset can be reverted.
- Destructive ops (remove, delete) are never bundled silently — shown first, unchecked
  by default.

This gate is also the prompt-injection defence. Web pages and saved tweets are untrusted
text; the worst they can do is make Claude *propose* something you then see in red.

---

## Changes, by codebase

### A. HF Space (`craftsmanship/hf-space`)

1. **New `POST /api/agent`** + `services/agent.ts`. `/api/chat` is untouched.
   Body: `messages, model, systemPrompt, thinking, mcpServers, maxTurns`.
2. **Lock the tool surface.** `allowedTools` = `WebSearch`, `WebFetch`, and `mcp__<server>__*`
   for the servers supplied. Explicit `disallowedTools` for Bash/Read/Write/Edit/Glob/Grep,
   `settingSources: []`.
3. **MCP host allowlist** (`MCP_ALLOWED_HOSTS` env) so a leaked app secret can't aim your
   subscription at an arbitrary server.
4. **Rich event stream** — the native feel:
   - `thinking {text}` — thinking deltas (currently dropped; only a banner is sent)
   - `text {text}`
   - `tool_start {id, name}` · `tool_input {id, partialJson}` · `tool_call {id, name, input}`
   - `tool_result {id, isError, preview}`
   - `turn {n}` · `usage {turns, durationMs, tokens}` · `ping` every 15 s · `done` / `error`
5. `maxTurns` default 40 (20 is tight once data reads are turns too).

### B. API (`server/`)

1. **`/mcp` endpoint** — `@modelcontextprotocol/sdk`, streamable HTTP, stateless. Auth =
   run token → resolves to run, user, changeset. New `services/agentTools.ts` holds the
   tools; they call the existing `storage.ts` and item-hygiene code.
2. **`services/agentRun.ts`** — starts a run against the Space, consumes the rich stream,
   buffers events, flushes to Supabase in ~1 s batches, fans out to SSE subscribers.
   Replaces the role of `runJsonOnce` for chat.
3. **`routes/chat.ts`** — threads, send message (starts run), `GET /runs/:id/events` (SSE
   with `Last-Event-ID` replay), stop run, changeset get/apply/revert.
4. **`services/changesets.ts`** — op validation, diff building (captures `before`), apply
   with version check, undo.
5. **Queue.** `JobStatus` gains `queued`; `JobKind` gains `chat`. A small in-process
   limiter (2 concurrent, FIFO) so queued asks don't trip subscription rate limits. Runs
   show in the existing `TaskNotifications` rail.
6. **Stop** actually stops: API aborts its fetch → the Space already kills the subprocess
   on disconnect. (Today a running job can't be cancelled — `routes/jobs.ts:30`.)
7. **System prompt** — short: who you are, what the tools are, "all writes are proposals
   the user reviews", plus the view snapshot. The rulebook is offered as the house
   standard for curation work; the user's request wins (same stance as today's
   `direct-request` mode). Stays user-editable, shown in `BrainPanel`.
8. **Migration `008_chat.sql`**: `taste_chat_threads`, `taste_chat_messages`,
   `taste_chat_runs` (events jsonb, token hash, status), `taste_changesets`.
9. **History.** The Space is stateless and flattens turns to text. The API sends prior
   turns plus one-line records of what happened ("staged +12 items — accepted"). Good
   enough; SDK session resume is a later option (Space disk is ephemeral).

### C. Web (`web/`)

1. **`ChatDock`** — orange circle, bottom-left (that corner is free; cog/account/embed sit
   top-right, notifications right rail). Opens a panel: thread list, transcript, composer,
   model picker (the Space already serves `/api/models`), thinking toggle, Stop.
2. **Context chip** — `Physical › Watches › Submariner 5513`, each level removable.
   Fed by a `ChatViewContext` that `DatasetView`, `ItemModal`, `Home`, `WorldReview` set.
3. **Transcript rows** like Claude Code: collapsible thinking, `Read Watches · 214 items`,
   `Searched: "pre-war Japanese wristwatches"`, `Staged 10 items`, with live tool input.
4. **`ChangesetReview`** — the diff above, inline in the chat and expandable full-screen.
5. **Item "Ask Claude"** button = opens the dock with that item as context.

### D. What happens to the existing flows

Nothing is deleted up front. `/api/chat` and every `runJson` call keep working throughout.

- **Review / Find what I'm missing / Expand** → become **preset prompts** (one tap, opens
  the dock prefilled). The presets are editable text, not code.
- **New-dataset wizard** (`Curate.tsx`) → stays until chat can match it; then a preset.
- **World map review** → stays for now; its output feeds the canvas. Map ops come later.
- **`BrainPanel`** → gains the agent prompt, tool list, presets.
- Retire the old calls one at a time, only after you've used the chat version and prefer it.

---

## Build order

| # | Slice | You can then… |
|---|---|---|
| 1 | Space `/api/agent` + rich events | see the full event stream with `curl` |
| 2 | API run engine + `/mcp` with **read tools only** + ChatDock | ask anything about what's on screen, watch Claude work live, pick the model |
| 3 | Propose tools + changesets + diff UI + apply/undo | "expand this", "fix these years", "split this field" — and approve it |
| 4 | Queue, thread history, stop, notifications | fire off several asks and come back later |
| 5 | Presets replace Review buttons; BrainPanel update | retire the hardcoded flows |
| 6 | Vision (check/choose images via `attachments`), map ops | Claude verifies pictures, redraws the map |

Slice 2 is the point where it starts to feel different. Slice 3 is the product.

---

## Decisions for you

1. **Personal world.** Chat there sends your private notes/tweets to Claude (your own
   subscription). Default I'd pick: allowed, with the context chip making it visible.
2. **Notes.** You mentioned adding your notes — `Item` has no notes field today. Add
   `notes` (yours, never overwritten by Claude without a diff) in slice 3?
3. **Auto-accept.** Claude Code has "accept edits" mode. Want a per-thread toggle for
   add-only changesets, or always review? Default: always review; undo exists either way.
4. **Local dev.** HF can't reach `localhost`, so tools won't work against a local API.
   Run the Space locally too (`claude login`, `PORT=7860`, `HF_BASE_URL=http://localhost:7860`).

## Risks

- **Subscription rate limits** with parallel agent runs → the 2-slot queue.
- **Render restarts mid-run** → run reads as interrupted (as jobs do now); staged ops
  already flushed are kept, so partial work isn't lost.
- **Big datasets in context** → `get_dataset` compact mode + `search_items`, not a full
  dump in the system prompt.
- **Shared Space** → new endpoint only; IphoneClaude untouched.
