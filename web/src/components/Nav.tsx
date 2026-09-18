import { Link, useLocation } from 'react-router-dom';
import { DOMAIN_LABELS, slugifyTopic } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { useDatasetList } from '../lib/data';
import { useAuth } from '../lib/auth';
import { NavActionsSlot } from '../lib/navActions';
import { BrainButton } from './BrainPanel';

// Centred pill-style top nav — a floating rounded bar (6-ui.md), not a full-width
// banner. It sits at the top of the page and scrolls away with it: the one thing worth
// keeping on screen while you scroll is the field's own name, and that's pinned by the
// screen that owns it (DatasetView) rather than carried here.
//
// The bar reads as a PATH, the way a file system does: TasteTrainer / Physical /
// Paintings. Each segment is where you'd click to get back to that level, and the last
// one is where you are. It replaced a "switch world" button and a page title, both of
// which were saying the same thing in a less useful way — a path tells you where you
// are *and* how to leave, in the space the title alone used to take.
export function Nav() {
  const { pathname } = useLocation();
  const domain = useDomain();
  const { email, signOut } = useAuth();
  // Only to turn a slug in the URL back into the field's real name. Cached and
  // usually already warm, since you nearly always arrive at a field from the shelf.
  const { data: datasets } = useDatasetList(domain);

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; to: string }> = [{ label: 'TasteTrainer', to: '/' }];

  if (domain) {
    crumbs.push({ label: DOMAIN_LABELS[domain].short, to: `/${domain}` });

    const second = segments[1];
    if (second === 'new') {
      crumbs.push({ label: 'New dataset', to: `/${domain}/new` });
    } else if (second === 'review') {
      crumbs.push({ label: 'Review', to: `/${domain}/review` });
    } else if (second) {
      // Prefer the field's actual name; fall back to un-slugifying the URL, which is
      // right often enough to never show a placeholder while the list loads.
      const match = (datasets ?? []).find((d) => slugifyTopic(d.topic) === second);
      const label = match?.topic ?? second.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      crumbs.push({ label, to: `/${domain}/${second}` });
      if (segments[2] === 'filters') {
        crumbs.push({ label: 'Filters', to: `/${domain}/${second}/filters` });
      }
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 pt-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div />
        <nav className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-1.5 shadow-sm backdrop-blur">
        <div className="flex shrink-0 items-center px-2">
          {crumbs.map((crumb, i) => {
            const last = i === crumbs.length - 1;
            return (
              <span key={crumb.to} className="flex items-center">
                {i > 0 && <span className="px-1.5 text-[var(--color-line)]">/</span>}
                {last ? (
                  // Where you are: still a path segment, just not a way to go anywhere.
                  <span
                    className={`serif whitespace-nowrap ${
                      i === 0 ? 'text-lg font-semibold tracking-tight' : 'text-base'
                    }`}
                  >
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    to={crumb.to}
                    className={`serif whitespace-nowrap text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] ${
                      i === 0 ? 'text-lg font-semibold tracking-tight' : 'text-base'
                    }`}
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            );
          })}
        </div>

        {/* AI work in flight is counted in the notification column itself
            (TaskNotifications' "N running" header) — a "N waiting" pill used to sit
            here, but it counted finished-but-undismissed jobs too and read as a
            confusing backlog rather than activity. */}

        {/* The account, last and quiet: shown only once there's a session to sign out
            of — most of a visit (the physical and digital worlds) never creates one.
            Inside the pill rather than in the empty left track, which is where
            DatasetView pins the field's title. */}
        {email && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--color-line)]" />
            <button
              onClick={signOut}
              title={`Signed in as ${email}`}
              className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)] hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </>
        )}
        {/* The settings cog's narrow-window home. At `xl`+ it moves out to the window's
            right margin (main.tsx); below that there's no margin, and a fixed button
            would sit on top of the nav actions to the right of this pill. */}
        <BrainButton className="flex hover:bg-[var(--color-wall-soft)] xl:hidden" />
        </nav>
        {/* The page owning the current route portals its own action buttons in here
            (lib/navActions.tsx), so they sit inline with the bar instead of on a row
            of their own below it. */}
        <NavActionsSlot className="flex flex-wrap items-center justify-end gap-2" />
      </div>
    </div>
  );
}

