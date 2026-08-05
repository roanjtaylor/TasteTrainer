import { isPeriodAccurate, type Capture, type CandidateSource } from '../../../shared/types';

// Marks a digital item whose image can't be trusted to show what it claims — a live
// capture standing in for a past year, an archived snapshot that landed well off
// target, or an image the scoring layer had real doubts about (7-software-design.md,
// "Known issue: screenshots show the present day").
//
// It sits over the image rather than in the fields because the image is the thing
// that's wrong, and because the whole point is that the two cases are visually
// indistinguishable: a present-day screenshot of a site labelled 2004 looks like a
// perfectly good item until something says otherwise. Silence means either "fine"
// or "not known" (physical items, and anything curated before capture was recorded)
// — the badge only ever appears when there is a real mismatch to report.
export function CaptureBadge({ capture, year }: { capture?: Capture; year: number | null }) {
  const periodWrong = !isPeriodAccurate(capture, year);
  // Low confidence is its own warning: the picture may be fine for the year and still
  // be the wrong picture — a placeholder, a near-blank render, or an unattributed
  // search result. Period accuracy alone never caught those.
  const lowConfidence = capture?.confidence === 'low';
  if (!periodWrong && !lowConfidence) return null;

  const label = periodWrong
    ? capture?.kind === 'live'
      ? 'live site, not the era'
      : `captured ${capture?.year ?? '?'}`
    : (capture?.note ?? 'low confidence');

  const title = periodWrong
    ? `This image is not period-accurate for ${year}. Swap it to pick a nearer snapshot.`
    : `This image scored low: ${capture?.note ?? 'unverified'}. Swap it if it looks wrong.`;

  return (
    <span
      title={title}
      className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-[var(--color-accent)] px-2.5 py-0.5 text-xs text-white shadow-sm"
    >
      ⚠ {label}
    </span>
  );
}

const SOURCE_LABEL: Record<CandidateSource, string> = {
  'wayback-render': 'web archive',
  'live-render': 'live capture',
  'paid-screenshot': 'screenshot API',
  mshots: 'mshots',
  wikipedia: 'Wikipedia',
  commons: 'Commons',
  'ia-software': 'Internet Archive',
  ddg: 'image search',
  manual: 'chosen by you',
};

export function sourceLabel(source?: CandidateSource): string {
  return source ? (SOURCE_LABEL[source] ?? source) : 'unknown source';
}

/** Where an image came from, stated plainly.
 *
 *  Provenance is shown rather than implied because every source here is high-variance:
 *  the same pipeline can return our own archive render, an encyclopaedia photograph, or
 *  an unattributed web search result, and those deserve very different amounts of
 *  trust from someone studying the picture. */
export function SourceTag({ capture }: { capture?: Capture }) {
  if (!capture?.source) return null;
  return (
    <span className="text-xs text-[var(--color-muted)]">
      {sourceLabel(capture.source)}
      {capture.confidence && capture.confidence !== 'high' ? ` · ${capture.confidence} confidence` : ''}
    </span>
  );
}
