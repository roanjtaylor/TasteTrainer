import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Domain } from '../../../shared/types';

// The active domain (7-software-design.md): plain in-memory React state, not
// persisted to localStorage. That's deliberate — the resolved decision was a
// dedicated landing screen on every session, not a remembered toggle, and a
// hard refresh naturally clearing this state is what makes that true for free.
interface DomainContextValue {
  domain: Domain | null;
  setDomain: (d: Domain) => void;
}

const DomainContext = createContext<DomainContextValue | null>(null);

export function DomainProvider({ children }: { children: ReactNode }) {
  const [domain, setDomain] = useState<Domain | null>(null);
  return <DomainContext.Provider value={{ domain, setDomain }}>{children}</DomainContext.Provider>;
}

export function useDomain(): DomainContextValue {
  const ctx = useContext(DomainContext);
  if (!ctx) throw new Error('useDomain must be used within a DomainProvider');
  return ctx;
}
