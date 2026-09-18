import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// The browser's Supabase client — used for exactly two things: signing in
// (lib/auth.tsx) and sending a file straight to Storage with a single-use token the
// server issued (lib/files.ts). It never reads or writes a table: every `taste_*`
// table has RLS on with no policies, so this key couldn't if it tried. All data still
// goes through our own API, which is where the access token this client holds is
// actually checked (server/src/auth.ts).
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
