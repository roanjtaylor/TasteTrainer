import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { useDomain } from './domain';
import { clearAll } from './store';

// The personal world's front door (9-personal-and-auth.md).
//
// Only the personal world is sensitive — private uploads, family photos — so signing
// in is only ever asked of someone entering it. The physical and digital worlds are
// researched, public-domain knowledge and are never gated. This doesn't make the
// personal world private by itself (the server checks the token on every request,
// server/src/auth.ts; a wall only the browser enforces is a curtain) — it's what keeps
// a visit to /personal from being a page of failed requests instead of a login form.

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
 * rendering — signing in is asked for only where it's actually needed (`PersonalGate`
 * below), not as a condition for the whole app to render at all.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
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
 * Wraps the routed content: shows the sign-in screen in place of the page whenever
 * the current URL is inside the personal world (`/personal/...`) and nobody is signed
 * in. Every other world renders straight through, untouched.
 */
export function PersonalGate({ children }: { children: ReactNode }) {
  const domain = useDomain();
  const { loading, email } = useAuth();

  if (domain !== 'personal') return <>{children}</>;
  if (!supabase) return <Misconfigured />;
  if (loading) return null;
  if (!email) return <SignIn />;
  return <>{children}</>;
}

const FIELD =
  'w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-wall)] px-4 py-3 outline-none placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]';

function SignIn() {
  // Creating the account happens here too, once, rather than in the Supabase
  // dashboard. It can afford to be open: an account only gets past the server if its
  // email is on ALLOWED_EMAILS, so a stranger who signs up has an account and nothing else.
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) setError(error.message);
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) setError(error.message);
      // No session back means the project requires the address to be confirmed first.
      else if (!data.session) {
        setNotice('Check your email for a confirmation link, then sign in here.');
        setMode('in');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-8 text-center">
        <h1 className="serif text-3xl">Your personal world</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {mode === 'in'
            ? 'Private to you — sign in to enter.'
            : 'Create your account.'}
        </p>
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
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'up' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Password"
            className={FIELD}
          />
          {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
          {notice && <p className="text-sm text-[var(--color-muted)]">{notice}</p>}
          <button
            type="submit"
            disabled={busy || !email.trim() || !password}
            className="rounded-full bg-[var(--color-accent)] px-6 py-2.5 text-sm text-white disabled:opacity-40"
          >
            {busy ? 'One moment…' : mode === 'in' ? 'Sign in →' : 'Create account →'}
          </button>
        </form>
        <button
          onClick={() => {
            setMode(mode === 'in' ? 'up' : 'in');
            setError('');
          }}
          className="mt-4 text-xs text-[var(--color-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
        >
          {mode === 'in' ? 'First time here? Create your account' : 'Already have one? Sign in'}
        </button>
      </div>
    </div>
  );
}

function Misconfigured() {
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
