import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';

// The account's home in the chrome: the window's top-right corner, not a bare
// "Sign out" text button appended to the end of the nav pill. Signed in, it's an
// avatar-style initial that opens a small menu (who you are, sign out); signed out,
// it's a quiet "Log in" link into the personal world, the only place a session is
// ever asked for (lib/auth.tsx).
//
// Mounted twice by the shell (main.tsx / Nav.tsx), same as EmbedTesterButton, each
// showing at its own breakpoint.
export function AccountButton({ className = '' }: { className?: string }) {
  const { email, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!email) {
    return (
      <Link
        to="/personal"
        title="Sign in to your personal world"
        className={`h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-full px-3 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] ${className}`}
      >
        Log in
      </Link>
    );
  }

  const initial = email[0]?.toUpperCase() ?? '?';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title={`Signed in as ${email}`}
        aria-label="Account"
        aria-expanded={open}
        className={`h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] ${className}`}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
          {initial}
        </span>
      </button>
      {open && (
        <>
          {/* A click anywhere outside closes the menu — no state of its own to track. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-2 shadow-lg">
            <p className="truncate px-2 py-1 text-xs text-[var(--color-muted)]">{email}</p>
            <button
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--color-wall-soft)]"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
