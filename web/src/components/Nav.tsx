import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { DOMAIN_LABELS } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { useRanker } from '../lib/ranker';

// Persistent, centred pill-style top nav — a floating rounded bar (6-ui.md),
// not a full-width banner.
//
// It carries only what the current place can act on: at the gate ("/") there is no
// world yet, so the bar is just the wordmark. Inside a world it gains that world's
// utilities — new dataset, and the shelf's edit mode.
export function Nav() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const domain = useDomain();
  const { ranker, release } = useRanker();

  const editing = params.get('edit') === '1';
  const onNew = domain != null && pathname === `/${domain}/new`;

  return (
    <div className="sticky top-4 z-20 flex justify-center px-4">
      <nav className="flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-1.5 shadow-sm backdrop-blur">
        <Link
          to={domain ? `/${domain}` : '/'}
          className="serif px-4 py-1.5 text-lg font-semibold tracking-tight text-[var(--color-ink)]"
        >
          TasteTrainer
        </Link>
        {domain && (
          <>
            <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
            {/* Current world + the way back to switch (7-software-design.md). */}
            <Link
              to="/"
              title="Switch world"
              className="rounded-full px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
            >
              {DOMAIN_LABELS[domain].short} ⇄
            </Link>
            <span className="mx-1 h-5 w-px bg-[var(--color-line)]" />
            <PillLink to={`/${domain}/new`} active={onNew}>
              New dataset
            </PillLink>
            {/* Edit mode is a shelf state, so this both goes to the shelf and turns it
                on — reachable from anywhere in the world, and shareable as a URL. */}
            <PillLink to={editing ? `/${domain}` : `/${domain}?edit=1`} active={editing}>
              Edit datasets
            </PillLink>
          </>
        )}
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
