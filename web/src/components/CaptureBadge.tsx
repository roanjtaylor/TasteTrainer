import { isPeriodAccurate, type Capture } from '../../../shared/types';

// Marks a digital item whose screenshot can't be showing the design of its year —
// a live capture standing in for a past year, or an archived snapshot that landed
// well off target (7-software-design.md, "Known issue: screenshots show the present
// day").
//
// It sits over the image rather than in the fields because the image is the thing
// that's wrong, and because the whole point is that the two cases are visually
// indistinguishable: a present-day screenshot of a site labelled 2004 looks like a
// perfectly good item until something says otherwise. Silence means either "fine"
// or "not known" (physical items, and anything curated before capture was recorded)
// — the badge only ever appears when there is a real mismatch to report.
export function CaptureBadge({ capture, year }: { capture?: Capture; year: number | null }) {
  if (isPeriodAccurate(capture, year)) return null;

  const label =
    capture?.kind === 'live' ? 'live site, not the era' : `captured ${capture?.year ?? '?'}`;

  return (
    <span
      title={`This screenshot is not period-accurate for ${year}. Swap the image to pick a nearer snapshot.`}
      className="absolute left-2 top-2 rounded-full bg-[var(--color-accent)] px-2.5 py-0.5 text-xs text-white shadow-sm"
    >
      ⚠ {label}
    </span>
  );
}
