export const PORT = Number(process.env.PORT) || 5174;

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-4-8';

// HF Space proxy — proxies Claude using the owner's subscription (no API credits consumed).
export const HF_BASE_URL = process.env.HF_BASE_URL ?? 'https://roanjtaylor-iphone-claude.hf.space';
export const HF_APP_SECRET = process.env.HF_APP_SECRET ?? '';

// Supabase (Squadova project) — cloud persistence for datasets and comparison results.
export const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
