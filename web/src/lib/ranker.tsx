import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { cleanRankerName, rankerKeyOf, type Ranker } from '../../../shared/types';

// Who's ranking — the arcade cabinet's name plate.
//
// You type a name once and your choices are filed under it. No account, no password,
// no verification round trip: the point of the arcade model is that the cost of
// getting your own leaderboard is three seconds of typing, so people actually do it
// rather than ranking anonymously into a shared pile.
//
// Deliberately the opposite persistence choice from the domain gate (lib/domain.tsx),
// which re-asks every session on purpose. A name is not a mode you're choosing, it's
// who you are — being asked for it twice would be friction, not a moment. So it lives
// in localStorage and survives reloads.
//
// It is an identity, not an authentication: anyone who types your name gets your
// board. That's the accepted trade for having no login at all, and it's the same
// promise a real arcade cabinet makes.

const STORAGE_KEY = 'tastetrainer.ranker';

interface RankerContextValue {
  ranker: Ranker | null;
  /** Claim a name. Returns the stored ranker, or null if the name was unusable. */
  claim: (name: string) => Ranker | null;
  /** Step away from the cabinet — the next person types their own name. */
  release: () => void;
}

const RankerContext = createContext<RankerContextValue | null>(null);

function readStored(): Ranker | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Ranker;
    const name = cleanRankerName(parsed?.name ?? '');
    return name ? { key: rankerKeyOf(name), name } : null;
  } catch {
    return null;
  }
}

export function RankerProvider({ children }: { children: ReactNode }) {
  const [ranker, setRanker] = useState<Ranker | null>(readStored);

  const claim = useCallback((raw: string): Ranker | null => {
    const name = cleanRankerName(raw);
    if (!name) return null;
    const next: Ranker = { key: rankerKeyOf(name), name };
    setRanker(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked — the name still works for this session, it just won't
      // survive a reload. Better than refusing to let someone rank.
    }
    return next;
  }, []);

  const release = useCallback(() => {
    setRanker(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing to clean up */
    }
  }, []);

  const value = useMemo(() => ({ ranker, claim, release }), [ranker, claim, release]);
  return <RankerContext.Provider value={value}>{children}</RankerContext.Provider>;
}

export function useRanker(): RankerContextValue {
  const ctx = useContext(RankerContext);
  if (!ctx) throw new Error('useRanker must be used within a RankerProvider');
  return ctx;
}
