import { Link, useLocation } from 'react-router-dom';
import { DOMAIN_LABELS } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { useRanker } from '../lib/ranker';

// Persistent, centred pill-style top nav — a floating rounded bar (6-ui.md),
// not a full-width banner.
export function Nav() {
  const { pathname } = useLocation();
  const { domain } = useDomain();
  const { ranker, release } = useRanker();
  const onDatasets = pathname === '/datasets';
  return (
    <div className="sticky top-4 z-20 flex justify-center px-4">
      <nav className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-1.5 shadow-sm backdrop-blur">
        <Link
          to="/"
          className="serif px-4 py-1.5 text-lg font-semibold tracking-tight text-[var(--color-ink)]"
        >
          TasteTrainer
        </Link>
        {domain && (
          <>
            <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
            {/* Current domain + the way back to switch (7-software-design.md) — the
                landing screen is the gate, this is just a reminder + escape hatch. */}
            <Link
              to="/"
              title="Switch world"
              className="rounded-full px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
            >
              {DOMAIN_LABELS[domain].short} ⇄
            </Link>
          </>
        )}
        <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
        <PillLink to="/datasets" active={onDatasets}>
          Datasets
        </PillLink>
        <PillLink to="/new" active={pathname === '/new'}>
          + New
        </PillLink>
        {/* Whose scores the next vote lands on. Click to hand the cabinet over. */}
        {ranker && (
          <>
            <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
            <button
              onClick={release}
              title="Rank as someone else"
              className="rounded-full px-3 py-1.5 text-xs uppercase tracking-wider text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
            >
              {ranker.name}
            </button>
          </>
        )}
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
