import { useLocation } from 'react-router-dom';
import { DOMAINS, type Domain } from '../../../shared/types';

// The active domain (7-software-design.md) is the first segment of the URL:
// /physical, /physical/ships, /digital/new. Previously it was in-memory React state
// chosen at a landing gate; the URL now carries it instead, which is what makes
// /physical/ships a real address — shareable, bookmarkable, and correct after a
// refresh or a back button. The gate at "/" is still the way in, just no longer the
// only thing that knows which world you're in.

/** The world a path is in, or null for the landing gate / anything unrecognised. */
export function domainOf(pathname: string): Domain | null {
  const first = pathname.split('/')[1] ?? '';
  return (DOMAINS as readonly string[]).includes(first) ? (first as Domain) : null;
}

/** The world the current route is in. null means "not in a world" — pages redirect
 *  to the gate on that, so a typo'd URL lands somewhere sensible. */
export function useDomain(): Domain | null {
  return domainOf(useLocation().pathname);
}
