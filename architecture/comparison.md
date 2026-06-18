# Comparison — training taste

**Purpose**
Where looking turns into *judgement*. The app shows two items from a dataset side by side and makes you pick the better one. Forcing a binary decision — no "they're both nice" — is what builds a defined sense of good vs. better. Over many comparisons, a ranking emerges that reflects *your* taste.

**The core decision(s)**
1. **The interaction** — what a single comparison looks like.
2. **How a ranking accumulates** — turning many 1v1 choices into an order.
3. **What you see for your effort** — making the internalized taste visible.

**Recommended default**
- **Interaction:** pick a dataset → two items appear side by side → you click the one you prefer (or press ← / →). Immediately show the next pair. Fast, repetitive, low-friction — that repetition is the training.
- **Ranking:** each item carries a simple rating that moves up when it wins and down when it loses (an **Elo**-style score, the same idea used to rank chess players or "hot or not" style apps). Two close-rated items being compared is more informative, so prefer pairing items with similar scores or that you haven't seen yet.
- **What you see:** a **leaderboard** for the dataset — items ranked best → worst by their score — so your developing taste is visible and you can revisit the top items. Every choice is also logged to `results/<datasetId>.json` and persists between sessions.

*Why:* the binary forced choice is the mechanism that creates taste; Elo turns scattered choices into a stable order without you having to rank a long list manually; the leaderboard closes the loop (internalize → see what you value).

**Open questions**
- Is a single **"which is better?"** the right question, or do you want a richer prompt sometimes (e.g. "which would you rather own / which is more *beautiful*")?
- Simple **win/loss tally** vs **Elo** for ranking? (Default: Elo — more meaningful order from fewer comparisons.)
- Should comparisons stay **within one dataset** only, or ever pit items from **different** datasets against each other later?
- Want a sense of "**done**" (e.g. enough comparisons to trust the ranking), or open-ended practice?
