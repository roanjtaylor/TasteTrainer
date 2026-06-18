import { Link, useLocation } from 'react-router-dom';

// Persistent, centred pill-style top nav — a floating rounded bar (6-ui.md),
// not a full-width banner.
export function Nav() {
  const { pathname } = useLocation();
  const onHome = pathname === '/';
  return (
    <div className="sticky top-4 z-20 flex justify-center px-4">
      <nav className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-1.5 shadow-sm backdrop-blur">
        <Link
          to="/"
          className="serif px-4 py-1.5 text-lg font-semibold tracking-tight text-[var(--color-ink)]"
        >
          TasteTrainer
        </Link>
        <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
        <PillLink to="/" active={onHome}>
          Datasets
        </PillLink>
        <PillLink to="/new" active={pathname === '/new'}>
          + New
        </PillLink>
      </nav>
    </div>
  );
}

function PillLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-[var(--color-ink)] text-[var(--color-wall)]'
          : 'text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]'
      }`}
    >
      {children}
    </Link>
  );
}
