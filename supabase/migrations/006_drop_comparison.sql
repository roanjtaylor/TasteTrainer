-- TasteTrainer migration 006. Drops the pairwise-comparison / leaderboard feature's
-- storage: the frontend and server code for it (comparisons, per-person rankings) was
-- removed already, leaving these as dead tables/view with no code path reading or
-- writing them.

DROP VIEW IF EXISTS taste_ranker_summaries;
DROP TABLE IF EXISTS taste_rankings;
DROP TABLE IF EXISTS taste_comparison_results;
