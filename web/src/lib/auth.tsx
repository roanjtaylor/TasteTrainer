import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { clearAll } from './store';

// Where signing in is asked for (9-personal-and-auth.md).
//
// Nothing is gated by WORLD: the personal world's shelf and its public collections are
// browsable signed out, same as the physical and digital ones. What's private is a
// DATASET marked `private` — row level security hides it until the curator signs in
// (lib/db.ts), so the dataset view shows the sign-in form in place of a collection it
// couldn't read (pages/DatasetView.tsx). The one route gated outright is /personal/new:
// a form that only writes, and only for the signed-in curator (server/src/auth.ts checks
// the token on every write — a wall only the browser enforces is a curtain). The Claude
// dock is the other thing that exists only signed in (components/chat/ChatDock.tsx,
// lib/chatView.tsx's `canAsk`): visitors browse and report problems; the curator talks
// to Claude.

interface AuthContextValue {
  /** undefined while still asking supabase-js whether a stored session exists. */
  loading: boolean;
  /** "" when signed out — the personal world just isn't reachable yet. */
  email: string;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loading: false,
  email: '',
  signOut: async () => {},
});

/** Usable anywhere — `email` is "" when signed out, since most of the app (the
 *  physical and digital worlds) never needs a session at all. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

/**
 * Tracks the Supabase session and provides it via `useAuth`, without blocking
 * rendering — signing in is asked for only where it's actually needed (`RequireSignIn`
 * below), not as a condition for the whole app to render at all.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Whether the last known state had a session — null until the first answer. Used to
  // tell an actual sign-in from the other events that carry a session (the restored
  // one on load, a token refresh, a tab regaining focus).
  const hadSession = useRef<boolean | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      hadSession.current = !!data.session;
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      // Signed-out reads are a different view of the data — private datasets missing
      // from the shelf, upload URLs unsigned — so what was cached before signing in is
      // wrong now. Dropping it refetches whatever is on screen (lib/store.ts#drop).
      if (next && hadSession.current === false) clearAll();
      hadSession.current = !!next;
      setSession(next);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading: session === undefined,
      email: session?.user.email ?? '',
      signOut: async () => {
        // The read cache (lib/store.ts) keeps whole datasets in localStorage so a
        // revisit paints instantly. Left behind, it would go on painting them for
        // whoever opens this browser next, signed in or not.
        clearAll();
        await supabase?.auth.signOut();
      },
    }),
    // Keyed on the user, not the session object: a token refresh swaps the session
    // every hour and must not re-render the whole app under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session === undefined, session?.user.id],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Wraps a screen that only the signed-in curator can use (/personal/new): shows the
 * sign-in form in its place while nobody is signed in. Browsing is never gated this
 * way — a private dataset hides itself instead (see the note at the top of this file).
 */
export function RequireSignIn({ children, title, blurb }: { children: ReactNode; title?: string; blurb?: string }) {
  const { loading, email } = useAuth();

  if (!supabase) return <Misconfigured />;
  if (loading) return null;
  if (!email) return <SignIn title={title} blurb={blurb} />;
  return <>{children}</>;
}

const FIELD =
  'w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-wall)] px-4 py-3 outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]';

/** The sign-in form. Also the embed widget's front door for a personal collection
 *  (pages/Embed.tsx), where the copy says what's on the other side of it. */
export function SignIn({
  title = 'Your personal world',
  blurb = 'Private to you — sign in to enter.',
}: {
  title?: string;
  blurb?: string;
} = {}) {
  // Sign-in only — this is a single-tenant personal world, not a multi-user product.
  // The account is created once, outside the app (Supabase dashboard), and new sign-ups
  // are disabled at the Supabase project level. ALLOWED_EMAILS (server/src/config.ts)
  // is the second layer, in case that project setting is ever loosened.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-8 text-center">
        <h1 className="serif text-3xl">{title}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{blurb}</p>
        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            autoFocus
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            aria-label="Email"
            className={FIELD}
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className={FIELD}
          />
          {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="rounded-full bg-[var(--color-accent)] px-6 py-2.5 text-sm text-white disabled:opacity-40"
          >
            {busy ? 'One moment…' : 'Sign in →'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function Misconfigured() {
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="max-w-md rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-8">
        <h1 className="serif text-2xl">Sign-in isn’t configured</h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Set <code>VITE_SUPABASE_KEY</code> to the Curiosity project’s publishable key — in{' '}
          <code>web/.env.local</code> for local dev, and in the Vercel project’s environment
          variables for the deployed app — then restart. It’s a public value (Supabase dashboard →
          Project Settings → API Keys).
        </p>
      </div>
    </div>
  );
}
