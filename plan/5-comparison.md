# Comparison — training taste

> **UI →** this is the **Dataset view** (`6-ui.md`): browse the items, pick a scope, run the 1v1 forced choice, and see the leaderboard — all one screen. The interaction details below are the UI; the global shell/visual language lives in `6-ui.md`.

**Purpose**
Where looking turns into *judgement*. The app shows two items from a dataset side by side and makes you pick the better one. Forcing a binary decision — no "they're both nice" — is what builds a defined sense of good vs. better. Over many comparisons, a ranking emerges that reflects *your* taste.

**The core decision(s)**
1. **The interaction** — what a single comparison looks like.
2. **How a ranking accumulates** — turning many 1v1 choices into an order.
3. **What you see for your effort** — making the internalized taste visible.

**Recommended default**
- **Scope first (you choose what's in play):** before the session begins, you **select the dataset and which branches to include** — narrow by subtopic and/or era, or take the whole macro topic. This sets the pool the comparison draws from, so you train exactly the slice you care about (e.g. just *1930s mechanical watches*). *(Designed to extend to multiple datasets later; MVP can ship single-dataset.)*
- **Interaction:** two items appear side by side → you click the one you prefer (or press ← / →). Immediately show the next pair. **A single "which is better?"** — one clean question, no variants. Fast, repetitive, low-friction — that repetition is the training.
- **Ranking — Elo only:** each item carries a single **Elo** rating that rises on a win and falls on a loss (the chess / "hot or not" idea). Prefer pairing items with similar scores or not yet seen — more informative per click. **Just Elo for the MVP**, no second ranking method.
- **A clear "done" target:** the session has a defined end so it never drags — a **target number of comparisons as a function of the dataset size** (e.g. ~5 comparisons per item, so each item is seen enough for a trustworthy order). A **progress bar** counts toward it. Past the target you may keep going, but you get a clear "ranking ready" moment.
- **What you see:** a **leaderboard** for the chosen slice — items ranked best → worst by Elo — so your developing taste is visible and you can revisit the top items. Every choice is logged to `results/<datasetId>.json` and persists between sessions.

*Why:* scope-first keeps each session focused and matches the faceted model; the binary forced choice is the mechanism that creates taste; Elo turns scattered choices into a stable order from few comparisons; a size-based done target gives a real sense of progress; the leaderboard closes the loop (internalize → see what you value).

**Resolved (2026-06-18)**
1. **Question = single "which is better?"** — simplest, just click your favourite. Richer prompts (most beautiful / would rather own) deferred.
2. **Ranking = Elo only** for the MVP — keep it simple.
3. **Scope chosen up front** — user picks the dataset / branches to include before the experience begins. (Cross-dataset mixing is a natural later extension of the same scope picker; not required for MVP.)
4. **Clear "done" target** — a function of item count (default lean ≈ 5 comparisons/item) with a progress bar, so the user has a concrete sense of progress rather than open-ended grind.

**Small residual to confirm (non-blocking)**
- The exact "done" multiple (≈5×items? higher for big sets?) — tune once we see real datasets; the *shape* (proportional to size, with a progress bar) is decided.
