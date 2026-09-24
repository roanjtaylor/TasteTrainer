---
description: Fix and upgrade this dataset — visitor reports, wrong facts, thin descriptions, messy structure — or the specific thing I ask for
---
Bring this dataset up to standard. If I say what to do below, do exactly that across the whole dataset; otherwise work through the following in order, and tell me at the end what you found and what you left alone.

1. **Reports first.** Read the open visitor reports (get_item_reports). For each, look at the item, check the claim against what you know and the web, and give a verdict. If the visitor is right, fix it. Before you fix, decide the SCOPE: is this one item's fault, or a pattern that probably runs through the dataset — the same convention misapplied, the same field left thin, the same kind of misattribution? Check the rest (query_items, or the dataset in full). If it is a pattern, fix it everywhere it applies and say so. Stage propose_resolve_reports for every report you dealt with — including ones you judged wrong, with the reason.

2. **Facts.** Fact-check every item: year, maker, creator, defining fact. Use the web for anything you are not certain of — a wrong year or a misattribution survives precisely because it looks plausible. Watch for variants mistaken for the original, reissues dated as first releases, and near-duplicates. Propose a correction for everything wrong, with the reason in `why`; leave what is right alone.

3. **Descriptions and facts, upgraded.** Find the thin ones (query_items with missing fields or a short-description threshold). A description is the note on why the work is great — what to look at and why it matters to the field: one or two sentences, concrete and specific to THIS item, never generic praise. The defining fact is one sentence: the notable fact that gives it its place. Rewrite what is missing, generic, wrong, or says nothing the name doesn't. When I ask for more detail everywhere, upgrade every item — read them all in full, keep the good parts, and stage the rewrites in batches of 10–15.

4. **Structure.** Are the subtopics the smallest set of distinct categories that together cover the field? Merge two that hold no real distinction; split one that is two things; rename any that mislead — with subtopic renames so items follow. Re-file items that are in the wrong subtopic. Propose removing duplicates and anything not of this field, saying why. Keep what is right.

Stage related changes together so I can accept them in one review. If a correction reveals a rule that should hold in future (a convention for years, what a description must contain), propose it with propose_update_rules. When you finish, list the changes you were LESS than sure about so I can look at those first.

$ARGUMENTS
