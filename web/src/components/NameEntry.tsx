import { useState } from 'react';
import { RANKER_NAME_MAX, cleanRankerName } from '../../../shared/types';
import { useRanker } from '../lib/ranker';

/**
 * The name plate prompt — shown once, in place of the ranking screen, before a
 * nameless visitor can start choosing.
 *
 * Modelled on an arcade cabinet's high-score entry: one field, no password, no email,
 * no "create an account" step. Everything about it is trying to be a smaller ask than
 * a login, because the reason to have names at all is comparing whose taste is whose —
 * and that only works if entering one is nearly free.
 */
export function NameEntry({
  title = 'Who’s ranking?',
  blurb = 'Enter a name and your choices are saved under it — no account, no password. Come back later on this device and it’ll still be yours.',
}: {
  title?: string;
  blurb?: string;
}) {
  const { claim } = useRanker();
  const [name, setName] = useState('');
  const ready = cleanRankerName(name).length > 0;

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)] p-8 text-center">
      <h2 className="serif text-3xl">{title}</h2>
      <p className="mx-auto mt-3 max-w-sm text-sm text-[var(--color-muted)]">{blurb}</p>

      <form
        className="mt-6 flex flex-col items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) claim(name);
        }}
      >
        <input
          autoFocus
          value={name}
          maxLength={RANKER_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="YOUR NAME"
          aria-label="Your name"
          className="serif w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-wall)] px-4 py-3 text-center text-2xl uppercase tracking-[0.2em] outline-none placeholder:tracking-normal placeholder:text-[var(--color-muted)] focus:border-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={!ready}
          className="w-full rounded-full bg-[var(--color-accent)] px-6 py-2.5 text-sm text-white disabled:opacity-40"
        >
          Start ranking →
        </button>
      </form>
    </div>
  );
}

/** The small "you are X — not you?" line shown above a ranking session. */
export function RankerBadge() {
  const { ranker, release } = useRanker();
  if (!ranker) return null;
  return (
    <span className="inline-flex items-center gap-2 text-sm text-[var(--color-muted)]">
      Ranking as
      <span className="rounded-full bg-[var(--color-accent)] px-3 py-0.5 text-xs uppercase tracking-wider text-white">
        {ranker.name}
      </span>
      <button onClick={release} className="underline underline-offset-2 hover:text-[var(--color-ink)]">
        not you?
      </button>
    </span>
  );
}
