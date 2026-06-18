# TasteTrainer — Architecture

These docs capture the **core decisions** for the project, one per aspect, in their simplest form. The goal (from `../ethos.md`) is a personal, local-first "bicycle for the mind": deliberately expose yourself to the best work humanity has made, train your eye through forced 1v1 judgement, and build defined taste.

We decide each aspect **doc by doc** before building. Each doc is short and uses the same shape:

- **Purpose** — what this aspect is.
- **The core decision(s)** — the key choice(s) to make.
- **Recommended default** — my suggestion + one-line why.
- **Open questions** — what you should weigh in on.

## The core themes

Numbered **1 → 5 by increasing concreteness** — from the abstract skeleton, through the data model, to the concrete features built on it.

| Doc | The one core thing it decides |
|---|---|
| [1-setup.md](1-setup.md) | The skeleton — stack, runs on localhost, data lives as files on disk |
| [2-data.md](2-data.md) | What we store — the shape of a *dataset* and an *item* |
| [3-curation.md](3-curation.md) | How a dataset gets *made* with AI — topic → research → review → save |
| [4-images.md](4-images.md) | How each item gets a *real image* — Wikimedia + an alternative picker |
| [5-comparison.md](5-comparison.md) | How taste gets *trained* — 1v1 forced choice → a ranking |

## How to use these

Read a doc, accept or change the **Recommended default**, answer the **Open questions**. Once an aspect is decided, we expand it into detailed design + build steps. Nothing is built until the core ideas here are right.
