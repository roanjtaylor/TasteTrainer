import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// A slot the nav bar exposes so routed pages — mounted as a *sibling* of <Nav />, not
// a child — can render their own toolbar buttons inline with it. Nav owns the DOM
// node (NavActionsSlot); pages portal their buttons into it (NavActions) so each page
// keeps owning its own button state/handlers exactly as before.
const NavActionsContext = createContext<{
  node: HTMLDivElement | null;
  setNode: (el: HTMLDivElement | null) => void;
} | null>(null);

export function NavActionsProvider({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return (
    <NavActionsContext.Provider value={{ node, setNode }}>{children}</NavActionsContext.Provider>
  );
}

export function NavActionsSlot({ className }: { className?: string }) {
  const ctx = useContext(NavActionsContext);
  if (!ctx) throw new Error('NavActionsSlot must be used within a NavActionsProvider');
  return <div ref={ctx.setNode} className={className} />;
}

export function NavActions({ children }: { children: ReactNode }) {
  const ctx = useContext(NavActionsContext);
  if (!ctx) throw new Error('NavActions must be used within a NavActionsProvider');
  if (!ctx.node) return null;
  return createPortal(children, ctx.node);
}
