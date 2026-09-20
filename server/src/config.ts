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

// The chat's run limits (services/agentRun.ts). These are THIS PRODUCT'S choices, sent
// to the Space with every run — the Space itself imposes none of them. CHAT_MAX_TURNS is
// how many tool round-trips one reply may take before Claude must answer: generous,
// because reading a dataset, searching the web and staging batches are each a turn; it
// exists so a run that has lost the plot stops on its own rather than on your Stop
// button. 0 = no cap. The deadline is the same hour-scale backstop as every other call.
export const CHAT_MAX_TURNS = Number(process.env.CHAT_MAX_TURNS ?? 150);
export const CHAT_TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS) || 3 * 60 * 60_000;
// The most one response may run to. The engine behind the Space defaults to 32k tokens
// and tops out at 64k; a big batch of proposed items, or a long essay, wants the room.
export const CHAT_MAX_OUTPUT_TOKENS = Number(process.env.CHAT_MAX_OUTPUT_TOKENS) || 64_000;

// HF Space proxy — proxies Claude using the owner's subscription (no API credits consumed).
export const HF_BASE_URL = process.env.HF_BASE_URL ?? 'https://roanjtaylor-claudesubscription.hf.space';
export const HF_APP_SECRET = process.env.HF_APP_SECRET ?? '';

// Supabase (Curiosity project) — cloud persistence for datasets and comparison results.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// Who may use the app at all (9-personal-and-auth.md). Comma-separated emails.
//
// Signing in proves you have an account in the Curiosity Supabase project — but that
// project is shared with other personal projects, and anyone can create an account in
// a Supabase project with its public key. So "is signed in" is not the same as "is
// me"; this list is what closes that gap. Empty means any signed-in account of the
// project gets through, which index.ts warns about at startup.
export const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

// The private Storage bucket holding the personal world's uploaded files (migration
// 005). Private with NO storage policies: only this server's service-role key can
// read or write it, and the browser only ever sees short-lived signed URLs.
export const PERSONAL_BUCKET = process.env.PERSONAL_BUCKET ?? 'taste-personal';
