import { Link, useLocation } from 'react-router-dom';
import { DOMAIN_LABELS, slugifyTopic } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { useDatasetList } from '../lib/data';
import { useRanker } from '../lib/ranker';

// Persistent, centred pill-style top nav — a floating rounded bar (6-ui.md),
// not a full-width banner.
//
// The bar reads as a PATH, the way a file system does: TasteTrainer / Physical /
// Paintings. Each segment is where you'd click to get back to that level, and the last
// one is where you are. It replaced a "switch world" button and a page title, both of
// which were saying the same thing in a less useful way — a path tells you where you
// are *and* how to leave, in the space the title alone used to take.
export function Nav() {
  const { pathname } = useLocation();
  const domain = useDomain();
  const { ranker, release } = useRanker();
  // Only to turn a slug in the URL back into the field's real name. Cached and
  // usually already warm, since you nearly always arrive at a field from the shelf.
  const { data: datasets } = useDatasetList(domain);

  const segments = pathname.split('/').filter(Boolean);
  const crumbs: Array<{ label: string; to: string }> = [{ label: 'TasteTrainer', to: '/' }];

  // The field being looked at, when there is one — its name and description are shown
  // beside the bar, since the path can only carry the name.
  let field: { topic: string; description: string } | null = null;

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
      field = { topic: label, description: match?.description ?? '' };
    }
  }

  return (
    <div className="sticky top-3 z-20 px-4">
      {/* Three zones on a normal window; wraps to centred rows on a narrow one, rather
          than squeezing the bar until its contents overflow. The right zone is empty and
          exists only to keep the bar itself centred against the left one. */}
      <div className="flex flex-wrap items-center justify-center gap-2 md:grid md:grid-cols-[1fr_auto_1fr] md:gap-3">
        <div className="order-1 min-w-0 md:justify-self-start">
          {field && (
            <div className="min-w-0">
              <h1 className="serif truncate text-xl leading-tight">{field.topic}</h1>
              {field.description && (
                <p className="truncate text-xs text-[var(--color-muted)]">{field.description}</p>
              )}
            </div>
          )}
        </div>

        <nav className="order-3 flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-1.5 shadow-sm backdrop-blur md:order-2">
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

        {/* Nothing else lives here. The bar is the path and only the path — actions
            belong next to the thing they act on, so "new dataset" is a button above the
            map and editing a field happens inside that field. */}

        {/* Whose scores the next vote lands on. Click to hand the cabinet over. */}
        {ranker && (
          <>
            <span className="mx-1 h-5 w-px shrink-0 bg-[var(--color-line)]" />
            <button
              onClick={release}
              title="Rank as someone else"
              className="shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs uppercase tracking-wider text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
            >
              {ranker.name}
            </button>
          </>
        )}
        </nav>

        <div className="order-2 md:order-3" />
      </div>
    </div>
  );
}

