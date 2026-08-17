export const PORT = Number(process.env.PORT) || 5174;

// Must be a real model id: the HF Space forwards it verbatim, and an invented id
// (this defaulted to the non-existent "claude-opus-4-8") only ever worked because the
// Space happened to override it. Override with CLAUDE_MODEL to try a newer model.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5';

// Hard cap on ONE Claude call, end to end. An hour: the Space no longer limits
// response length, every call is a durable job that survives the browser leaving, and
// a big research call (28+ items, each with a specific image query) legitimately runs
// well past the old per-call minute budgets — those were sized for the earlier proxy
// limits and cut a working 20-of-28 run off at 5 minutes. This is a stuck-request
// backstop, not a budget. Override with CLAUDE_TIMEOUT_MS.
export const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 60 * 60_000;

// HF Space proxy — proxies Claude using the owner's subscription (no API credits consumed).
export const HF_BASE_URL = process.env.HF_BASE_URL ?? 'https://roanjtaylor-claudesubscription.hf.space';
export const HF_APP_SECRET = process.env.HF_APP_SECRET ?? '';

// Supabase (Curiosity project) — cloud persistence for datasets and comparison results.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
