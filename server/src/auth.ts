import type { NextFunction, Request, Response } from 'express';
import { supabase } from './supabase.ts';
import { ALLOWED_EMAILS } from './config.ts';

// The authentication wall (9-personal-and-auth.md).
//
// Only the personal world is sensitive — private uploads, family photos — so it's the
// only thing behind a wall. The physical and digital worlds are researched, public-domain
// knowledge, and stay fully open. The web app signs in with Supabase Auth and sends the
// session's access token as a Bearer header on every API call (web/src/lib/api.ts) when
// one exists.
//
// Two pieces: `attachUser` runs on every /api request and decodes a token if one was
// sent, but never rejects a request for lacking one — most routes don't need a user at
// all. `requireAuth` is the actual wall, applied only where personal-world content is at
// stake: the files router outright (uploads only ever serve the personal world), and
// inline in routes/datasets.ts wherever the dataset in play is domain === 'personal'.

export interface AuthUser {
  id: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth — present on every route mounted behind it. */
    user?: AuthUser;
  }
}

/**
 * Verified tokens, remembered briefly. Verifying means a round trip to Supabase Auth,
 * and one screen makes several API calls at once (shelf, map, jobs) — without this
 * each of them would pay that round trip for the same token. A minute is short enough
 * that signing out elsewhere, or being removed from the allowlist, takes effect almost
 * at once.
 */
const VERIFIED_TTL_MS = 60_000;
const verified = new Map<string, { user: AuthUser; expiresAt: number }>();

function remember(token: string, user: AuthUser): void {
  // Bounded by pruning on write: tokens rotate hourly, so this only ever holds a
  // handful, but a map that is never pruned is a slow leak on a long-lived process.
  if (verified.size > 100) {
    const nowMs = Date.now();
    for (const [key, entry] of verified) if (entry.expiresAt <= nowMs) verified.delete(key);
  }
  verified.set(token, { user, expiresAt: Date.now() + VERIFIED_TTL_MS });
}

async function verify(token: string): Promise<AuthUser | null> {
  const hit = verified.get(token);
  if (hit && hit.expiresAt > Date.now()) return hit.user;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const user: AuthUser = { id: data.user.id, email: data.user.email.toLowerCase() };
  remember(token, user);
  return user;
}

/** Decode a Bearer token into `req.user` when one is sent. Never rejects — a missing
 *  or invalid token just leaves `req.user` unset, and it's up to the specific route
 *  (or `requireAuth` below) to decide whether that's fatal. */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'OPTIONS') return next();

  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next();

  try {
    const user = await verify(token);
    if (user && (!ALLOWED_EMAILS.length || ALLOWED_EMAILS.includes(user.email))) {
      req.user = user;
      // The browser's own HTTP cache keeps dataset responses for a while; keying them
      // on the token means a copy cached for one session is never served into another.
      res.vary('Authorization');
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** The actual wall: mounted only where personal-world content is at stake. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === 'OPTIONS') return next();
  // A rejection must never be cached — a stored 401 would outlive the sign-in.
  res.set('Cache-Control', 'no-store');
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to access your personal world.' });
    return;
  }
  res.removeHeader('Cache-Control');
  next();
}
