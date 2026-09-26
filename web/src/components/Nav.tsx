import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { DOMAIN_LABELS, slugifyTopic } from '../../../shared/types';
import { useDomain } from '../lib/domain';
import { useDatasetList } from '../lib/data';
import { NavActionsSlot } from '../lib/navActions';

// Centred pill-style top nav — a floating rounded bar (6-ui.md), not a full-width
// banner. It hides while you scroll down, to leave the content clear, and slides back in
// as soon as you scroll up, so you can navigate from anywhere in a long list. The field's
// own name is pinned separately by the screen that owns it (DatasetView).
//
// The bar reads as a PATH, the way a file system does: TasteTrainer / Physical /
// Paintings. Each segment is where you'd click to get back to that level, and the last
// one is where you are. It replaced a "switch world" button and a page title, both of
// which were saying the same thing in a less useful way — a path tells you where you
// are *and* how to leave, in the space the title alone used to take.
function useHiddenOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    function onScroll() {
      const y = window.scrollY;
      // Ignore jitter, and never hide near the top.
      if (Math.abs(y - last) < 8) return;
      setHidden(y > last && y > 80);
      last = y;
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return hidden;
}

export function Nav() {
  const { pathname } = useLocation();
  const hidden = useHiddenOnScrollDown();
  const [params, setParams] = useSearchParams();
  const newestFirst = params.get('order') === 'newest';
  const domain = useDomain();
  // Only to turn a slug in the URL back into the field's real name. Cached and
  // usually already warm, since you nearly always arrive at a field from the shelf.
  const { data: datasets } = useDatasetList(domain);

  const segments = pathname.split('/').filter(Boolean);
  // On a dataset's own page (not /new), its crumb carries the sort-direction arrow.
  const onDataset = !!domain && !!segments[1] && segments[1] !== 'new';
  const crumbs: Array<{ label: string; to: string }> = [{ label: 'TasteTrainer', to: '/' }];

  if (segments[0] === 'iframe') {
    crumbs.push({ label: 'Iframe', to: '/iframe' });
  } else if (domain) {
    crumbs.push({ label: DOMAIN_LABELS[domain].short, to: `/${domain}` });

    const second = segments[1];
    if (second === 'new') {
      crumbs.push({ label: 'New dataset', to: `/${domain}/new` });
    } else if (second) {
      // Prefer the field's actual name; fall back to un-slugifying the URL, which is
      // right often enough to never show a placeholder while the list loads.
      const match = (datasets ?? []).find((d) => slugifyTopic(d.topic) === second);
      const label = match?.topic ?? second.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
      crumbs.push({ label, to: `/${domain}/${second}` });
    }
  }

  return (
    <>
     {/* Fixed, not sticky: #root is only viewport-tall (index.css), so a sticky bar's
         container ends after the first screen and it stops following the scroll. The
         spacer holds the bar's place in the flow. */}
     <div aria-hidden="true" className="h-[3.25rem]" />
    <div
      className={`pointer-events-none fixed inset-x-0 top-0 z-30 transition-transform duration-200 ${
        hidden ? '-translate-y-full' : ''
      }`}
    >
     <div className="pointer-events-auto mx-auto max-w-6xl pl-6 pr-14 pt-3 xl:px-6">
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
                    {onDataset && i === crumbs.length - 1 && (
                      <button
                        onClick={() =>
                          setParams(newestFirst ? {} : { order: 'newest' }, { replace: true })
                        }
                        title={newestFirst ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'}
                        aria-label="Toggle sort order"
                        className="ml-1.5 text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                      >
                        {newestFirst ? '↓' : '↑'}
                      </button>
                    )}
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

        </nav>
        {/* The page owning the current route portals its own action buttons in here
            (lib/navActions.tsx), so they sit inline with the bar instead of on a row
            of their own below it. */}
        <NavActionsSlot className="flex flex-wrap items-center justify-end gap-2" />
      </div>
     </div>
    </div>
    </>
  );
}

