import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The browser's Supabase client: signing in (lib/auth.tsx), every read the app makes
// (lib/db.ts — the shelf, datasets, maps, the embed widget), the small visitor/curator
// writes (item reports), and sending a file straight to Storage with a single-use
// token the server issued (lib/files.ts). What this key may see is decided by row
// level security (supabase/migrations/011_browser_reads.sql), which reads the session
// token the client holds. Everything that needs a server (the Claude agent, image
// sourcing, tweet import, uploads) goes through our own API instead (lib/api.ts).
//
// Both values are PUBLIC by design — the publishable key identifies the project, it
// doesn't authorise anything — so they are safe in the bundle and in Vercel's env.
const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://hionhaaihfjgopkhmlbk.supabase.co';
const key = import.meta.env.VITE_SUPABASE_KEY ?? '';

/** Null when the key isn't configured — the gate says so in words (lib/auth.tsx)
 *  rather than letting createClient throw "supabaseKey is required" into a blank page. */
export const supabase: SupabaseClient | null = key ? createClient(url, key) : null;

/** The current access token, refreshed by supabase-js if it had expired. */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
