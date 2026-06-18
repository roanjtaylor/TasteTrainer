# TasteTrainer — Architecture

These docs capture the **core decisions** for the project, one per aspect, in their simplest form. The goal (from `../ethos.md`) is a personal, local-first "bicycle for the mind": deliberately expose yourself to the best work humanity has made, train your eye through forced 1v1 judgement, and build defined taste.

We decide each aspect **doc by doc** before building. Each doc is short and uses the same shape:

- **Purpose** — what this aspect is.
- **The core decision(s)** — the key choice(s) to make.
- **Recommended default** — my suggestion + one-line why.
- **Open questions** — what you should weigh in on.

## The core themes

Numbered **1 → 6 by increasing concreteness** — from the abstract skeleton, through the data model, to the concrete features and the interface built on them.

| Doc | The one core thing it decides |
|---|---|
| [1-setup.md](1-setup.md) | The skeleton — stack, runs on localhost, data lives as files on disk |
| [2-data.md](2-data.md) | What we store — the shape of a *dataset* and an *item* |
| [3-curation.md](3-curation.md) | How a dataset gets *made* with AI — topic → research → review → save |
| [4-images.md](4-images.md) | How each item gets a *real image* — Wikimedia + an alternative picker |
| [5-comparison.md](5-comparison.md) | How taste gets *trained* — 1v1 forced choice → a ranking |
| [6-ui.md](6-ui.md) | How you *use* it — the screen map, design language, and styling tooling that tie it all together |

**UI lives in two places by design:** the *coherent whole* (screen map, visual language, styling) is owned by `6-ui.md`; *feature-specific interactions* stay in their feature doc (`3`–`5`), each flagged with a **UI →** pointer at the top. `2-data.md` has no UI of its own (it's the model the screens render).

## How to use these

Read a doc, accept or change the **Recommended default**, answer the **Open questions**. Once an aspect is decided, we expand it into detailed design + build steps. Nothing is built until the core ideas here are right.

**Status (2026-06-18):** all six docs have **confirmed core decisions** (each carries a *Resolved* / *Decisions locked* section). Only small, non-blocking residuals remain (era bucket size, exact "done" multiple, a look-and-feel reference). The plan is intended as the **canonical, regenerable source of truth** — the software is spun up from it, and can be wiped and regenerated if a core decision changes, so the docs are kept internally consistent.
