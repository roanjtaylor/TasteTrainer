import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.ts';

// The one service-role client. It lived inside storage.ts while rows were the only
// thing the server touched in Supabase; auth (auth.ts) and private files
// (services/personalFiles.ts) need it too, and each making its own would be three
// copies of the same credentials.
//
// No session handling: this client never signs in as anyone. It verifies other
// people's tokens and otherwise acts as the service role, so persisting or refreshing
// a session would be meaningless work on a server.
export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
