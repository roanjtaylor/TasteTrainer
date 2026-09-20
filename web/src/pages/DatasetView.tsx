import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { slugifyTopic } from '../../../shared/types';
import type {
  CoverageGap,
  Dataset,
  Domain,
  EraGroup,
  FillMode,
  Item,
  Job,
  ProposedItem,
  Subtopic,
} from '../../../shared/types';
import { api } from '../lib/api';
import { saveDataset, useDataset } from '../lib/data';
import { dismissTask, finishTask, runTracked, startTask, updateTask } from '../lib/tasks';
import { currentJob, groupKey, jobsFor, refreshJobs, useJobs } from '../lib/jobs';
import { eraGroupsOf, itemsInGroup } from '../lib/format';
import { physicalImageQuery } from '../lib/image';
import { ItemCard } from '../components/ItemCard';
import { ItemModal } from '../components/ItemModal';
import { TweetCard } from '../components/TweetCard';
import { TweetImportPanel } from '../components/TweetImportPanel';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';
import { BackToTop } from '../components/BackToTop';
import { PersonalFieldEditor } from '../components/PersonalFieldEditor';
import { ReviewDialog } from '../components/ReviewDialog';
import { ReviewCard } from './Curate';
import { NavActions } from '../lib/navActions';

// The single active filter — one axis at a time (a subtopic OR an era-group), or none.
// Derived from the URL so it's shareable and back-button friendly.
type ActiveFilter =
  | { kind: 'subtopic'; name: string }
  | { kind: 'era'; group: EraGroup }
  | null;

/** A freeform ask from the review dialog, on its way to GapPanel's research call. */
type DirectRequest = { prompt: string; count: number; nonce: number };

// ---- Grid zoom ----
// How many cards sit across the row: 1 (one card filling the width) to 10 (a tight
// mosaic). Deliberately NOT persisted — every fresh load (including a plain refresh)
// starts back at DEFAULT_COLS, so the desktop default is always the three-wide view
// rather than whatever size a previous session happened to leave it zoomed to.
const MIN_COLS = 1;
const MAX_COLS = 10;
const DEFAULT_COLS = 3;

// The Dataset view (6-ui.md): browse the items and pick a scope — all one screen.
export function DatasetView() {
  // /physical/ships — the world and the field, both readable in the address bar.
  const { domain = '', slug = '' } = useParams();
  // Cached read: a dataset seen before paints immediately and corrects itself in the
  // background, so returning to it costs nothing (lib/store.ts).
  const { data: ds, error: loadError, set: setDs } = useDataset(slug || null);
  // The shared job cache (lib/jobs.ts): read here so opening a dataset shows whatever
  // review or expansion is current for it — running or finished — without a detour
  // through the notification column's button (see the auto-resume effect below).
  const { jobs, loaded: jobsLoaded } = useJobs();

  const [gaps, setGaps] = useState<CoverageGap[] | null>(null);
  const [loadingGaps, setLoadingGaps] = useState(false);
  const [gapSuggestedCount, setGapSuggestedCount] = useState(8);
  const [gapError, setGapError] = useState('');

  // "Review" opens a choice of mode (components/ReviewDialog.tsx) rather than starting
  // a sweep outright. A direct request skips the sweep entirely: it's handed to
  // GapPanel, which owns the research call either mode ends in. `nonce` makes asking
  // the same thing twice a new request rather than a no-op.
  const [reviewOpen, setReviewOpen] = useState(false);
  const [directRequest, setDirectRequest] = useState<DirectRequest | null>(null);

  // Resuming a durable gap-fill job (lib/jobs.ts) landed on from the notification
  // gutter's "View" link — `?job=<id>` carries research that already finished (or is still running)
  // in a previous session. Handed to GapPanel, which hydrates its review grid from it
  // instead of requiring a fresh research() call.
  const [resumeJob, setResumeJob] = useState<Job | null>(null);
  const [resumingJob, setResumingJob] = useState(false);

  // The durable job (lib/jobs.ts) the current gap SWEEP came from (kind 'gaps' — not
  // to be confused with GapPanel's own gap-fill job). Superseded, not deleted, by a
  // fresh sweep: the old row's gaps are already replaced by the new ones on screen.
  const gapsJobIdRef = useRef<string | null>(null);
  // Every job id this page is already showing — started live here (its id arrives on
  // the first progress line), or resumed — so the auto-resume below never fetches a
  // job that's already on screen. A Set, not the two single refs, because GapPanel's
  // gap-fill job lives in its own ref and reports up through `trackJob`.
  const trackedJobsRef = useRef(new Set<string>());
  // Which dataset the auto-resume has already run for: once per dataset, the first
  // time the job list is known. Keyed by slug because this route component is
  // reused across datasets rather than remounted.
  const autoResumedForRef = useRef<string | null>(null);
  function trackJob(id: string) {
    trackedJobsRef.current.add(id);
  }

  // The single active filter lives in the URL (?sub=… or ?era=start-end), so it's
  // shareable and the back button steps through filter states. The Filters subpage
  // sets it; the pill's × clears it. One axis at a time (decision 3).
  const [searchParams, setSearchParams] = useSearchParams();

  const groups = useMemo(() => (ds ? eraGroupsOf(ds) : []), [ds]);

  // "Expand dataset" can be launched from outside this page — the world review's
  // thin-fields list links here with `?expand=1` so its button is a real one-click
  // action rather than just a navigation. The param is stripped immediately so a
  // refresh or the back button doesn't re-run the sweep.
  useEffect(() => {
    if (!ds || searchParams.get('expand') !== '1') return;
    setSearchParams(
      (p) => {
        p.delete('expand');
        return p;
      },
      { replace: true },
    );
    whatsMissing();
    // `searchParams` deliberately in the deps (not just `ds`): navigating here from
    // another dataset's "Expand dataset →" link reuses this same route component
    // (React Router doesn't remount on a param-only change), so `ds` may already be
    // the loaded object and never "change" — without `searchParams` here, the effect
    // would only fire on first mount and silently do nothing on a second visit. The
    // `delete('expand')` above makes the re-run this triggers a no-op, so this can't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, searchParams]);

  // Same idea, for `?job=<id>` — a link from the notification gutter's "View" button
  // to either kind of job this page can produce: a 'gaps' sweep (the coverage-gap list itself) or a
  // 'gap-fill' research call (a proposal built from gaps already found).
  useEffect(() => {
    const jobId = searchParams.get('job');
    if (!ds || !jobId) return;
    setSearchParams(
      (p) => {
        p.delete('job');
        return p;
      },
      { replace: true },
    );
    void resumeJobById(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, searchParams]);

  // Opening the dataset shows its current state, the same as the notification
  // column's button would: the newest running job, else the most advanced finished one
  // (lib/jobs.ts's `currentJob`) — a gap review, or an expansion waiting to be
  // accepted. Consistent across every way in: the gutter's link, the shelf, the
  // address bar, the back button. Skipped when a `?job=` / `?expand=` query is already
  // driving this page, and for any job this page itself started or already resumed.
  useEffect(() => {
    if (!ds || !jobsLoaded || autoResumedForRef.current === slug) return;
    if (searchParams.get('job') || searchParams.get('expand')) return;
    autoResumedForRef.current = slug;
    if (loadingGaps || resumingJob) return;
    const job = currentJob(jobsFor(jobs, groupKey(ds.domain, ds.topic)));
    if (!job || trackedJobsRef.current.has(job.id)) return;
    void resumeJobById(job.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, jobsLoaded, jobs, searchParams]);

  // Moving to another dataset within this same mounted route: the previous field's
  // gaps and proposal must not carry over onto the new one's page.
  useEffect(() => {
    setGaps(null);
    setGapError('');
    setResumeJob(null);
    setDirectRequest(null);
    setReviewOpen(false);
    gapsJobIdRef.current = null;
  }, [slug]);

  async function resumeJobById(id: string) {
    trackJob(id);
    setResumingJob(true);
    setGapError('');
    try {
      let job = await api.getJob(id);
      while (job.status === 'running') {
        await new Promise((r) => setTimeout(r, 5000));
        job = await api.getJob(id);
      }
      if (job.status === 'error') {
        setGapError(`Resumed job failed: ${job.error ?? 'unknown error'}`);
        return;
      }
      if (job.kind === 'gaps') {
        const result = job.result as { gaps: CoverageGap[]; suggestedCount: number };
        setGaps(result.gaps ?? []);
        setGapSuggestedCount(result.suggestedCount ?? 8);
        gapsJobIdRef.current = job.id;
        return;
      }
      // 'gap-fill' — the sweep's gaps travelled in as its input, the proposal it built
      // is handed to GapPanel via resumeJob.
      // A direct request had no sweep behind it: leave `gaps` null so the panel shows
      // the request it came from (read off the job by GapPanel) rather than an empty
      // gap list claiming "good coverage" that nothing ever measured.
      const input = job.input as { gaps?: CoverageGap[]; count?: number; mode?: FillMode };
      setGaps(input.mode === 'direct' ? null : (input.gaps ?? []));
      setGapSuggestedCount(input.count ?? 8);
      setResumeJob(job);
    } catch (e: any) {
      setGapError(e?.message ?? 'Could not resume this job');
    } finally {
      setResumingJob(false);
    }
  }

  async function whatsMissing(focus = '') {
    if (!ds) return;
    setLoadingGaps(true);
    setDirectRequest(null);
    setGaps(null);
    setGapError('');
    // A plain task, not `runTracked` — this call also creates a durable job row
    // server-side (see shared/types.ts's `Job`), and `refreshJobs()` below pulls it in
    // right after. That durable job is what represents this sweep in the notification
    // gutter from here on, with a "View"/"Retry" action a transient task never has —
    // so this one is dismissed the moment the call settles rather than left lingering
    // beside it, dead-ended on its last progress line with only a bare ✕.
    // Titled and grouped by the dataset (lib/tasks.ts), so the gutter shows one card —
    // "Engines · Review" — whichever step of this dataset's pipeline is running. The
    // previous sweep's job is noted before the call so it can be superseded once the
    // new one is named (the progress callback overwrites the ref).
    const previousSweep = gapsJobIdRef.current;
    const taskId = startTask(ds.topic, { group: groupKey(ds.domain, ds.topic), stage: 'Review' });
    try {
      const res = await api.findGaps(
        {
          topic: ds.topic,
          description: ds.description,
          subtopics: ds.subtopics,
          items: ds.items,
          domain: ds.domain,
          // Named periods go in so an era-shaped gap comes back named, matching what
          // the Filters screen and the gap-fill call already speak in.
          eraGroups: ds.eraGroups ?? [],
          focus,
        },
        (line, jobId) => {
          // The job's id arrives on the first progress line: note it straight away
          // (so the auto-resume above knows it's on screen) and pull the new row into
          // the shared cache now, so the gutter — and any other tab — sees it running
          // from the start rather than only once the call ends.
          if (jobId && gapsJobIdRef.current !== jobId) {
            gapsJobIdRef.current = jobId;
            trackJob(jobId);
            refreshJobs();
          }
          updateTask(taskId, line, jobId);
        },
      );
      finishTask(taskId, true);
      setGaps(res.gaps);
      setGapSuggestedCount(res.suggestedCount);
      if (res.jobId) {
        // Superseding whatever sweep was tracked before — its gaps are already
        // replaced by this one, so nothing is lost by forgetting it.
        if (previousSweep && previousSweep !== res.jobId) {
          api.deleteJob(previousSweep).catch(() => {});
        }
        gapsJobIdRef.current = res.jobId;
      }
    } catch (e: any) {
      finishTask(taskId, false, e?.message ?? 'Gap analysis failed');
      setGapError(e?.message ?? 'Gap analysis failed');
    } finally {
      dismissTask(taskId);
      setLoadingGaps(false);
      // Unconditional (success or thrown): the server creates the durable job row
      // BEFORE the Claude call, so a sweep that errors out still leaves a real
      // `status: 'error'` row behind — the SSE stream only reports an `error` event
      // in that case, never a `jobId`, so it'd otherwise stay invisible in the
      // gutter until something unrelated triggered a refetch.
      refreshJobs();
    }
  }

  const filter = useMemo<ActiveFilter>(() => {
    const sub = searchParams.get('sub');
    if (sub) return { kind: 'subtopic', name: sub };
    const era = searchParams.get('era');
    if (era) {
      const [s, e] = era.split('-').map(Number);
      if (Number.isFinite(s) && Number.isFinite(e)) {
        // Resolve the named group from the dataset; fall back to a bare range label.
        const group = groups.find((g) => g.start === s && g.end === e) ?? {
          label: `${s}–${e}`,
          start: s,
          end: e,
        };
        return { kind: 'era', group };
      }
    }
    return null;
  }, [searchParams, groups]);

  const pool = useMemo(() => {
    if (!ds) return [];
    if (!filter) {
      // No filter — show all items in chronological order (nulls last).
      return [...ds.items].sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
    }
    if (filter.kind === 'subtopic') return ds.items.filter((it) => it.subtopic === filter.name);
    return itemsInGroup(ds.items, filter.group);
  }, [ds, filter]);

  const filterLabel =
    filter == null ? null : filter.kind === 'subtopic' ? filter.name : filter.group.label;

  if (loadError) return <p className="mt-8 text-[var(--color-accent)]">{loadError}</p>;
  if (!ds) return <p className="mt-8 text-[var(--color-muted)]">Loading…</p>;

  return (
    <div className="space-y-6">
      {/* This field's name, description and in-scope count, pinned to the top-left for
          the whole scroll: on a long wall of images it's the one thing worth never
          losing. It's left-aligned in the margin beside the centred content column, so
          it sits alongside the grid rather than over it. Below md there's no margin to
          sit in, so it scrolls with the page like an ordinary heading. */}
      <div className="group relative md:fixed md:left-4 md:top-3 md:z-30 md:w-48 lg:w-60 xl:w-72">
        <h1 className="serif truncate text-xl leading-tight" title={ds.description || undefined}>
          {ds.topic}
        </h1>
        {ds.description && (
          <div
            role="tooltip"
            className="pointer-events-none invisible absolute left-0 top-full z-40 mt-1 w-64 rounded-md bg-black px-2.5 py-1.5 text-xs text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
          >
            {ds.description}
          </div>
        )}
        <p className="truncate text-xs text-[var(--color-muted)]">
          {pool.length} of {ds.items.length} items{filterLabel ? ' in scope' : ''}
        </p>
      </div>

      <NavActions>
        {/* Filters live behind this button — opens the /:domain/:slug/filters subpage. */}
        <Link
          to="filters"
          className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
        >
          Filters
        </Link>
        {/* "What's missing?" asks Claude to audit a field against the world's record of
            it. A personal collection has no such record to be short of — what belongs
            in it is whatever you say does (9-personal-and-auth.md). */}
        {ds.domain !== 'personal' && (
          <button
            onClick={() => setReviewOpen(true)}
            disabled={loadingGaps || !ds}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)] disabled:opacity-40"
          >
            {loadingGaps ? 'Sweeping…' : 'Review'}
          </button>
        )}
      </NavActions>

      {/* Active-filter read: a pill with × to clear. The count it used to sit beside now
          lives in the pinned title block, where it stays readable down the page. */}
      {filterLabel && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs text-white">
            {filterLabel}
            <button
              onClick={() => setSearchParams({})}
              aria-label="Clear filter"
              className="text-white/80 hover:text-white"
            >
              ✕
            </button>
          </span>
        </div>
      )}

      <Browse
        ds={ds}
        pool={pool}
        defaultSubtopic={filter?.kind === 'subtopic' ? filter.name : ''}
        gaps={gaps}
        gapSuggestedCount={gapSuggestedCount}
        gapError={gapError}
        resumeJob={resumeJob}
        resumingJob={resumingJob}
        directRequest={directRequest}
        trackJob={trackJob}
        onAccepted={() => {
          // The review is consumed once its additions are in: drop the sweep's row
          // too, so the dataset's notification card clears rather than falling back
          // to a stale "Review · View →" for gaps that have just been filled.
          if (gapsJobIdRef.current) {
            api.deleteJob(gapsJobIdRef.current).catch(() => {});
            gapsJobIdRef.current = null;
            refreshJobs();
          }
        }}
        onChanged={setDs}
      />

      {reviewOpen && (
        <ReviewDialog
          topic={ds.topic}
          onCancel={() => setReviewOpen(false)}
          onStart={(choice) => {
            setReviewOpen(false);
            if (choice.mode === 'sweep') {
              void whatsMissing(choice.focus);
              return;
            }
            // The sweep's list (if one is on screen) belongs to a different question;
            // showing it above a direct request would read as though the request had
            // been researched against those gaps, which it isn't.
            setGaps(null);
            setGapError('');
            setResumeJob(null);
            setDirectRequest({ prompt: choice.prompt, count: choice.count, nonce: Date.now() });
          }}
        />
      )}

      <BackToTop />
    </div>
  );
}

// ---- Browse ----
function Browse({
  ds,
  pool,
  defaultSubtopic,
  gaps,
  gapSuggestedCount,
  gapError,
  resumeJob,
  resumingJob,
  directRequest,
  trackJob,
  onAccepted,
  onChanged,
}: {
  ds: Dataset;
  pool: Item[];
  /** The subtopic filter in force, if any — what a newly added item is filed under, so
   *  adding while looking at "Novels" doesn't make the new book vanish from view. */
  defaultSubtopic: string;
  gaps: CoverageGap[] | null;
  gapSuggestedCount: number;
  gapError: string;
  resumeJob: Job | null;
  resumingJob: boolean;
  directRequest: DirectRequest | null;
  trackJob: (id: string) => void;
  onAccepted: () => void;
  onChanged: (ds: Dataset) => void;
}) {
  // Inline editing: `editing` holds a working copy of the item being edited; `picker`
  // toggles the image swapper for it; `saving` disables the form during the write.
  const [editing, setEditing] = useState<Item | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  // Only one card's details are ever open at a time — expanding one collapses whatever
  // else was open, so the wall of images doesn't fill up with expanded panels.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // General "click anything else closes it" rule: a mousedown outside the expanded
  // card's own DOM (tracked via this ref) collapses it, whatever that click turns out
  // to do — open the editor, open "+ Add item", swap the image, and so on. mousedown
  // (not click) so this runs before the target's own click handler, letting a click on
  // a *different* image collapse this one and expand that one in the same gesture
  // rather than closing then failing to reopen.
  const expandedRef = useRef<HTMLDivElement | null>(null);
  // Cards-per-row, driven by the zoom control fixed in the window's right margin below
  // — replaces the old fixed 1/2/3-column breakpoints with one continuous dial. Starts
  // at DEFAULT_COLS every mount (see the comment on it above) — a refresh, or coming
  // back from another dataset, always lands on the three-wide default.
  const [cols, setCols] = useState(DEFAULT_COLS);
  const setZoom = (next: number | ((c: number) => number)) =>
    setCols((c) => Math.max(MIN_COLS, Math.min(MAX_COLS, typeof next === 'function' ? next(c) : next)));

  // Zoom keeps whichever card you're focused on in place, rather than the reflow
  // yanking the whole page back to the top-left corner — a wall of a hundred cards is
  // otherwise unnavigable at speed, since every zoom step loses your place. `itemNodesRef`
  // is every rendered card's own DOM node, keyed by item id, kept live by the ref
  // callback below; `hoveredIdRef` is whichever one the pointer is over right now, kept
  // live by the onMouseEnter on each card wrapper. `anchorRef` is the card + its
  // on-screen position captured the instant BEFORE a zoom change is applied, so the
  // layout effect below can measure where that same card landed AFTER the reflow and
  // scroll by the difference — same trick a map or PDF viewer uses to zoom "into" a point.
  const itemNodesRef = useRef(new Map<string, HTMLElement>());
  const hoveredIdRef = useRef<string | null>(null);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);

  // `point`, when given (the wheel/pinch case), pins the anchor to whatever card is
  // literally under the pointer at that instant — more precise than the last
  // mouseenter, since a fast pinch can arrive before the enter event does. Without a
  // point (a zoom-control button or the slider, where the pointer is over the control,
  // not a card), it falls back to `hoveredIdRef` — the last card the mouse was over.
  function captureZoomAnchor(point?: { x: number; y: number }) {
    let id = hoveredIdRef.current;
    if (point) {
      const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-item-id]');
      if (hit?.dataset.itemId) id = hit.dataset.itemId;
    }
    const el = id ? itemNodesRef.current.get(id) : undefined;
    anchorRef.current = el ? { id: id as string, top: el.getBoundingClientRect().top } : null;
  }

  function zoomBy(next: number | ((c: number) => number)) {
    captureZoomAnchor();
    setZoom(next);
  }

  // Runs after the reflow but before the browser paints it, so the correction itself
  // is never visible — only the zoom is.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    anchorRef.current = null;
    if (!anchor) return;
    const el = itemNodesRef.current.get(anchor.id);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - anchor.top;
    if (delta) window.scrollBy(0, delta);
  }, [cols]);

  // Pinch-to-zoom, trackpad or mouse: both a trackpad pinch gesture and a ctrl/⌘+scroll
  // on a mouse wheel arrive in the browser as the same thing — a `wheel` event with
  // `ctrlKey` set (there's no separate pinch event on the web platform). Listened for
  // on the whole page, not just the grid, so it works the moment the cursor is
  // anywhere over the card wall, not just exactly between two cards. A plain,
  // unmodified scroll is left alone — that's still just scrolling the page.
  // Native addEventListener with `{ passive: false }`, not React's onWheel: the browser
  // treats wheel listeners as passive by default, which silently drops preventDefault
  // and lets the page itself zoom instead.
  const wheelAccumRef = useRef(0);
  useEffect(() => {
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // Anchor to whatever card is under the pointer right now — captured once per
      // event, before any of the steps below, so it reflects the card's position
      // before this event's reflow rather than a stale one from a previous step.
      captureZoomAnchor({ x: e.clientX, y: e.clientY });
      // A pinch fires a flurry of tiny deltas; accumulating and stepping in whole
      // columns keeps the grid from jittering between sizes on every event.
      wheelAccumRef.current += e.deltaY;
      const STEP = 12;
      // Pinching/scrolling "out" (deltaY > 0, same direction as zooming a page out)
      // shrinks the cards — more, smaller columns; the reverse zooms in.
      while (wheelAccumRef.current >= STEP) {
        wheelAccumRef.current -= STEP;
        setZoom((c) => c + 1);
      }
      while (wheelAccumRef.current <= -STEP) {
        wheelAccumRef.current += STEP;
        setZoom((c) => c - 1);
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
  // Tweets still expand in place (TweetCard), so a click outside the open thread
  // collapses it. A non-tweet item instead opens ItemModal below, which owns its own
  // closing (backdrop click, Escape, ✕) — this guard would otherwise fight it: the
  // modal's own buttons live outside `expandedRef` (the grid cell, not the modal), so
  // this listener would collapse `expandedId` out from under a click on them before
  // their own onClick ever ran.
  useEffect(() => {
    if (!expandedId) return;
    const openItem = pool.find((i) => i.id === expandedId);
    if (!openItem?.tweet) return;
    function onOutsideDown(e: MouseEvent) {
      if (expandedRef.current && !expandedRef.current.contains(e.target as Node)) {
        setExpandedId(null);
      }
    }
    document.addEventListener('mousedown', onOutsideDown);
    return () => document.removeEventListener('mousedown', onOutsideDown);
  }, [expandedId, pool]);

  // The personal world is built by hand (9-personal-and-auth.md), so its browse view
  // doubles as the builder: add one item, drop in a batch of files, delete, and edit
  // the dataset's own shape. None of it shows in the researched worlds.
  const personal = ds.domain === 'personal';
  const [editingField, setEditingField] = useState(false);
  // Offered where it makes sense: a dataset that already holds tweets, or an empty one
  // that could become one — not on a shelf of book covers.
  const [importingTweets, setImportingTweets] = useState(false);
  const takesTweets = personal && (ds.items.length === 0 || ds.items.some((i) => i.tweet));
  // A draft from "+ Add item" isn't in the dataset until it's saved — so it isn't in
  // `pool` either, and is drawn ahead of the grid instead (see `isNew` below).
  const isNew = !!editing && !ds.items.some((i) => i.id === editing.id);

  function blankItem(change: Partial<Item> = {}): Item {
    return {
      // Minted here rather than left to the server (which would, routes/datasets.ts):
      // the editor finds its item by id, and a draft needs one before its first save.
      id: crypto.randomUUID(),
      name: '',
      description: '',
      image: '',
      year: null,
      brand: '',
      creator: '',
      definingFact: '',
      subtopic: defaultSubtopic,
      createdAt: new Date().toISOString(),
      ...change,
    };
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await saveDataset(ds.id, {
        items: isNew
          ? [...ds.items, editing]
          : ds.items.map((i) => (i.id === editing.id ? editing : i)),
      });
      onChanged(updated);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  async function deleteEditing() {
    if (!editing) return;
    setSaving(true);
    try {
      // The server removes the item's uploaded file along with it (routes/datasets.ts).
      const updated = await saveDataset(ds.id, {
        items: ds.items.filter((i) => i.id !== editing.id),
      });
      onChanged(updated);
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* A sweep in progress (or the resume-from-job case below) is already announced
          by the top-right task notification (lib/tasks.ts) — this used to duplicate
          that with its own "Reviewing this field for gaps…" line. */}
      {resumingJob && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
          Picking up saved research…
        </p>
      )}
      <GapPanel
        ds={ds}
        gaps={gaps}
        suggestedCount={gapSuggestedCount}
        gapError={gapError}
        resumeJob={resumeJob}
        directRequest={directRequest}
        trackJob={trackJob}
        onAccepted={onAccepted}
        onChanged={onChanged}
      />

      {personal && (
        <NavActions>
          <button
            onClick={() => setEditingField((v) => !v)}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            Edit dataset
          </button>
          {takesTweets && (
            <button
              onClick={() => setImportingTweets((v) => !v)}
              className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
            >
              Import tweets
            </button>
          )}
          <button
            onClick={() => setEditing(blankItem())}
            disabled={!!editing}
            aria-label="Add item"
            title="Add item"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-ink)] text-lg leading-none text-[var(--color-wall)] disabled:opacity-40"
          >
            +
          </button>
        </NavActions>
      )}
      {personal && editingField && (
        <PersonalFieldEditor ds={ds} onChanged={onChanged} onClose={() => setEditingField(false)} />
      )}
      {takesTweets && importingTweets && (
        <TweetImportPanel ds={ds} onChanged={onChanged} onClose={() => setImportingTweets(false)} />
      )}

      {pool.length === 0 && !isNew ? (
        <p className="text-[var(--color-muted)]">
          {personal && ds.items.length === 0
            ? 'Nothing here yet — add an item to start the collection.'
            : 'No items in this scope.'}
        </p>
      ) : (
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {isNew && editing && (
            <ItemEditorCard
              key={editing.id}
              draft={editing}
              subtopics={ds.subtopics}
              domain={ds.domain}
              saving={saving}
              onChange={(c) => setEditing((e) => (e ? { ...e, ...c } : e))}
              onSwapImage={() => setPicker(true)}
              onSave={saveEdit}
              onCancel={() => setEditing(null)}
            />
          )}
          {pool.map((item) =>
            editing?.id === item.id ? (
              <ItemEditorCard
                key={item.id}
                draft={editing}
                subtopics={ds.subtopics}
                domain={ds.domain}
                saving={saving}
                onChange={(c) => setEditing((e) => (e ? { ...e, ...c } : e))}
                onSwapImage={() => setPicker(true)}
                onSave={saveEdit}
                onCancel={() => setEditing(null)}
                onDelete={personal ? deleteEditing : undefined}
              />
            ) : (
              <div
                key={item.id}
                data-item-id={item.id}
                ref={(el) => {
                  if (el) itemNodesRef.current.set(item.id, el);
                  else itemNodesRef.current.delete(item.id);
                  if (expandedId === item.id) expandedRef.current = el;
                }}
                onMouseEnter={() => {
                  hoveredIdRef.current = item.id;
                }}
                onMouseLeave={() => {
                  if (hoveredIdRef.current === item.id) hoveredIdRef.current = null;
                }}
                className="relative"
                // An open thread is for reading, and a tenth of the row isn't a readable
                // measure — so it takes about a third of the width whatever the zoom.
                style={
                  item.tweet && expandedId === item.id
                    ? { gridColumn: `span ${Math.max(1, Math.ceil(cols / 3))}` }
                    : undefined
                }
              >
                {item.tweet ? (
                  <TweetCard
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId((id) => (id === item.id ? null : item.id))}
                    onEdit={() => setEditing({ ...item })}
                  />
                ) : (
                /* The card itself opens the full-screen modal below — works on touch,
                   not just hover. */
                <ItemCard item={item} onOpen={() => setExpandedId(item.id)} />
                )}
              </div>
            ),
          )}
        </div>
      )}

      {expandedId &&
        !editing &&
        (() => {
          const openItem = pool.find((i) => i.id === expandedId);
          if (!openItem || openItem.tweet) return null;
          return (
            <ItemModal
              ds={ds}
              item={openItem}
              onClose={() => setExpandedId(null)}
              onChanged={onChanged}
            />
          );
        })()}

      {picker && editing && (
        <ImagePicker
          target={
            ds.domain === 'digital'
              ? {
                  kind: 'screenshot',
                  url: editing.url ?? '',
                  year: editing.year,
                  name: editing.name,
                  imageKind: editing.imageKind,
                  wikipediaTitle: editing.wikipediaTitle,
                  imageQuery: editing.imageQuery,
                }
              : { kind: 'search', query: physicalImageQuery(editing) }
          }
          allowUpload={personal}
          onPick={(url) => {
            // Hand-picked, so the recorded capture no longer describes this image.
            setEditing((e) => (e ? { ...e, image: url, capture: undefined } : e));
            setPicker(false);
          }}
          onClose={() => setPicker(false)}
        />
      )}

      {pool.length > 0 && <ZoomControl cols={cols} onChange={zoomBy} />}
    </div>
  );
}

// A vertical slider fixed in the window's right margin — the same home the settings
// cog and account button already keep there (main.tsx) — so scrolling a long wall of
// cards always leaves one dial in reach for how much of it is on screen at once.
// Dragging up = fewer, bigger cards (zoomed in, down to one filling the row); dragging
// down = more, smaller ones (zoomed out, up to a ten-wide mosaic). Continuous, so it
// replaces the old fixed sm/lg breakpoints with a real dial rather than three stops.
function ZoomControl({
  cols,
  onChange,
}: {
  cols: number;
  /** Clamps to [MIN_COLS, MAX_COLS] itself — callers can freely pass cols ± 1. */
  onChange: (next: number | ((c: number) => number)) => void;
}) {
  // The <input> itself always runs low-to-high bottom-to-top; the zoom LEVEL (big cards
  // = high zoom) is the inverse of the column count, so the thumb sits high when cards
  // are big and low when they're tiny, matching how a zoom slider reads everywhere else.
  const zoomLevel = MAX_COLS + MIN_COLS - cols;
  return (
    <div
      className="fixed bottom-6 right-3 z-30 flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--color-line)] bg-[var(--color-card)]/90 px-2 py-3 text-[var(--color-muted)] shadow-sm backdrop-blur"
      title={`${cols} across — drag, click ±, or pinch/ctrl+scroll over the grid`}
    >
      {/* Fewer, bigger cards. Disabled at one-across rather than hidden, so the
          button's position — and the dial below it — never jumps around. */}
      <button
        type="button"
        onClick={() => onChange((c) => c - 1)}
        disabled={cols <= MIN_COLS}
        aria-label="Zoom in (fewer, bigger cards)"
        className="select-none text-sm leading-none hover:text-[var(--color-ink)] disabled:opacity-30"
      >
        ＋
      </button>
      <input
        type="range"
        min={MIN_COLS}
        max={MAX_COLS}
        step={1}
        value={zoomLevel}
        onChange={(e) => onChange(MAX_COLS + MIN_COLS - Number(e.target.value))}
        aria-label="Zoom: cards per row"
        className="h-32 w-5 cursor-pointer accent-[var(--color-accent)]"
        style={{
          WebkitAppearance: 'slider-vertical',
          writingMode: 'vertical-lr',
          direction: 'rtl',
        } as React.CSSProperties}
        // Firefox's own vertical-range mechanism (ignores writing-mode on range inputs).
        // Not a real DOM attribute React knows about, so it's passed through untyped.
        {...{ orient: 'vertical' }}
      />
      {/* More, smaller cards. */}
      <button
        type="button"
        onClick={() => onChange((c) => c + 1)}
        disabled={cols >= MAX_COLS}
        aria-label="Zoom out (more, smaller cards)"
        className="select-none text-sm leading-none hover:text-[var(--color-ink)] disabled:opacity-30"
      >
        －
      </button>
      <span className="mt-0.5 select-none text-[10px] tabular-nums">{cols}×</span>
    </div>
  );
}

// Inline editor for a saved item — same minimalist form as the curate review grid,
// outlined in the accent colour so it reads as "editing". Save writes through to disk.
function ItemEditorCard({
  draft,
  subtopics,
  domain,
  saving,
  onChange,
  onSwapImage,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Item;
  subtopics: Subtopic[];
  domain: Domain;
  saving: boolean;
  onChange: (change: Partial<Item>) => void;
  onSwapImage: () => void;
  onSave: () => void;
  onCancel: () => void;
  /** Personal world only, and only for an item that's already saved. */
  onDelete?: () => void;
}) {
  return (
    <div className="space-y-2 border border-[var(--color-accent)] bg-[var(--color-card)] p-3">
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--color-wall-soft)]">
        <Photo src={draft.image} alt={draft.name} />
        <button
          onClick={onSwapImage}
          className="absolute bottom-2 right-2 rounded-full bg-[var(--color-ink)]/80 px-3 py-1 text-xs text-[var(--color-wall)]"
        >
          Swap image
        </button>
      </div>
      <ItemFields item={draft} subtopics={subtopics} domain={domain} onChange={onChange} />
      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-xs disabled:opacity-40"
        >
          Cancel
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            disabled={saving}
            className="ml-auto text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ---- "What's missing?" results panel ----
// Triggered from the header button; receives gap data from DatasetView.
// Manages only the add-items sub-flow: count, feedback, pending items, image picker.
function GapPanel({
  ds,
  gaps,
  suggestedCount,
  gapError,
  resumeJob,
  directRequest,
  trackJob,
  onAccepted,
  onChanged,
}: {
  ds: Dataset;
  gaps: CoverageGap[] | null;
  suggestedCount: number;
  gapError: string;
  resumeJob: Job | null;
  /** A freeform ask from the review dialog — researched as soon as it arrives. */
  directRequest: DirectRequest | null;
  /** Reports the durable job this panel is showing up to DatasetView, which keeps the
   *  page-wide set used to decide what (not) to auto-resume on open. */
  trackJob: (id: string) => void;
  /** Fired once researched additions have been saved into the dataset. */
  onAccepted: () => void;
  onChanged: (ds: Dataset) => void;
}) {
  const [count, setCount] = useState(suggestedCount);
  const [feedback, setFeedback] = useState('');
  const [researching, setResearching] = useState(false);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<ProposedItem[] | null>(null);
  // What the server had to correct in the batch. Shown rather than swallowed: a
  // proposal dropped as a repeat explains why you asked for 8 and got 6, and an item
  // with no subtopic is one you have to fix before it goes in.
  const [corrections, setCorrections] = useState({ duplicates: 0, unsetSubtopics: 0 });
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);
  const [savingAdd, setSavingAdd] = useState(false);
  const [error, setError] = useState('');
  // Which question this panel is answering: 'gaps' shows the sweep's list with the
  // text box as an optional steer; 'direct' has no list, and the text box IS the brief.
  const [mode, setMode] = useState<FillMode>('gaps');

  // Sync count when a new gap analysis completes with a fresh suggestion.
  useEffect(() => { setCount(suggestedCount); }, [suggestedCount]);

  // A sweep landing (live or resumed) puts the panel back in gaps mode.
  useEffect(() => { if (gaps) setMode('gaps'); }, [gaps]);

  // Another dataset on this same mounted route: nothing from the last one carries
  // over. Declared before the resume effect below so that, when both fire together,
  // the resumed job's state is what's left standing.
  useEffect(() => {
    setMode('gaps');
    setPending(null);
    setNote('');
    setFeedback('');
    setError('');
    setCorrections({ duplicates: 0, unsetSubtopics: 0 });
    jobIdRef.current = null;
  }, [ds.id]);

  // The durable job (lib/jobs.ts) this review grid came from, live or resumed — a ref
  // since nothing on screen needs to re-render off it. addToDataset()/Discard delete
  // it: once the user has acted on the proposal, there's nothing left to resume.
  const jobIdRef = useRef<string | null>(null);

  // A `?job=<id>` link landed a finished proposal directly in `resumeJob` — hydrate
  // the same state a fresh research() call would have set, no new Claude call needed.
  useEffect(() => {
    if (!resumeJob) return;
    const result = resumeJob.result as {
      items: ProposedItem[];
      note: string;
      duplicates: number;
      unsetSubtopics: number;
    };
    setPending(result.items ?? []);
    setNote(result.note ?? '');
    setCorrections({
      duplicates: result.duplicates ?? 0,
      unsetSubtopics: result.unsetSubtopics ?? 0,
    });
    jobIdRef.current = resumeJob.id;
    // A resumed direct request restores the request itself, so the panel can show what
    // was asked and the box is ready to refine and re-run.
    const input = resumeJob.input as { mode?: FillMode; feedback?: string; count?: number };
    if (input.mode === 'direct') {
      setMode('direct');
      setFeedback(input.feedback ?? '');
      setCount(input.count ?? 8);
    } else {
      setMode('gaps');
    }
  }, [resumeJob]);

  // A direct request from the review dialog: adopt it and research straight away —
  // the dialog's button was the go-ahead, so a second "Research" press here would
  // just be the instant-kickoff problem in reverse. Keyed on the nonce, so asking the
  // same thing twice is two requests.
  useEffect(() => {
    if (!directRequest) return;
    setMode('direct');
    setFeedback(directRequest.prompt);
    setCount(directRequest.count);
    void research({ mode: 'direct', feedback: directRequest.prompt, count: directRequest.count });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directRequest?.nonce]);

  // `run` carries the values for a call made in the same tick they were set (the
  // direct-request effect above), where the state they'd otherwise be read from
  // hasn't updated yet.
  async function research(run: { mode: FillMode; feedback: string; count: number } = { mode, feedback, count }) {
    if (run.mode === 'direct' && !run.feedback.trim()) {
      setError('Write what you’d like Claude to research first.');
      return;
    }
    setResearching(true);
    setError('');
    setNote('');
    setPending(null);
    // See the matching comment in whatsMissing() above — a plain task, dismissed once
    // the durable job (refreshJobs() below) is what's left representing this call.
    const previousJob = jobIdRef.current;
    const taskId = startTask(ds.topic, { group: groupKey(ds.domain, ds.topic), stage: 'Expand' });
    try {
      const res = await api.fillGaps(
        {
          topic: ds.topic,
          description: ds.description,
          subtopics: ds.subtopics,
          items: ds.items,
          // A direct request is researched on its own terms, not against a sweep.
          gaps: run.mode === 'direct' ? [] : (gaps ?? []),
          count: Math.max(1, Math.min(50, run.count || 8)),
          feedback: run.feedback,
          mode: run.mode,
          domain: ds.domain,
          // Named periods as context, so an added item's year lands inside a real
          // era of the field and an era-shaped gap can be filled by name.
          eraGroups: ds.eraGroups ?? [],
        },
        (line, jobId) => {
          // See whatsMissing(): note the id at once, and surface the row right away.
          if (jobId && jobIdRef.current !== jobId) {
            jobIdRef.current = jobId;
            trackJob(jobId);
            refreshJobs();
          }
          updateTask(taskId, line, jobId);
        },
      );
      finishTask(taskId, true);
      setPending(res.items);
      setNote(res.note);
      setCorrections({
        duplicates: res.duplicates ?? 0,
        unsetSubtopics: res.unsetSubtopics ?? 0,
      });
      if (res.jobId) {
        // Superseding whatever was tracked before (a resumed job re-run, or a second
        // live research() before the first was acted on) — its proposal is already
        // replaced by this one, so nothing is lost by forgetting it.
        if (previousJob && previousJob !== res.jobId) {
          api.deleteJob(previousJob).catch(() => {});
        }
        jobIdRef.current = res.jobId;
      }
    } catch (e: any) {
      finishTask(taskId, false, e?.message ?? 'Could not research additions');
      setError(e?.message ?? 'Could not research additions');
    } finally {
      dismissTask(taskId);
      setResearching(false);
      // Unconditional (success or thrown): the server creates the durable job row
      // BEFORE the Claude call, so a research call that errors out still leaves a
      // real `status: 'error'` row behind — the SSE stream only reports an `error`
      // event in that case, never a `jobId`, so it'd otherwise stay invisible in the
      // gutter until something unrelated triggered a refetch.
      refreshJobs();
    }
  }

  function forgetJob() {
    if (!jobIdRef.current) return;
    api.deleteJob(jobIdRef.current).catch(() => {});
    jobIdRef.current = null;
  }

  async function addToDataset() {
    if (!pending?.length) return;
    setSavingAdd(true);
    setError('');
    try {
      // Proposed items carry no id/createdAt; the server's PUT handler mints those
      // (toItem). The cast mirrors the curate expansion path's existingItems handling.
      const updated = await runTracked(
        ds.topic,
        () => saveDataset(ds.id, { items: [...ds.items, ...(pending as unknown as Item[])] }),
        { group: groupKey(ds.domain, ds.topic), stage: 'Save' },
      );
      onChanged(updated);
      forgetJob();
      onAccepted();
      // Clear the sub-flow; keep the gaps visible so the user can sweep again or add more.
      setPending(null);
      setNote('');
      setFeedback('');
      setCorrections({ duplicates: 0, unsetSubtopics: 0 });
    } catch (e: any) {
      setError(e?.message ?? 'Could not add items');
    } finally {
      setSavingAdd(false);
    }
  }

  const busy = researching || savingAdd;

  const direct = mode === 'direct';

  if (!gaps && !gapError && !direct) return null;

  return (
    <div className="space-y-4">
      {gapError && <p className="text-sm text-[var(--color-accent)]">{gapError}</p>}

      {(gaps || direct) && (
        <div className="space-y-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-4">
          {direct ? (
            <div>
              <h3 className="serif text-lg">Your request</h3>
              <p className="text-sm text-[var(--color-muted)]">
                Researched as asked — no sweep. Reword it and run again to refine.
              </p>
            </div>
          ) : (
            <div>
              <h3 className="serif text-lg">Coverage gaps</h3>
              {gaps && gaps.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No obvious gaps — good coverage.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-sm">
                  {(gaps ?? []).map((g, i) => (
                    <li key={i}>
                      <span className="text-[var(--color-accent)]">{g.axis}:</span> {g.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Research & add the missing items. */}
          <div className={`space-y-3 ${direct ? '' : 'border-t border-[var(--color-line)] pt-4'}`}>
            <label className="block">
              {!direct && (
                <span className="text-sm text-[var(--color-muted)]">
                  Your steer <span className="text-[var(--color-muted)]">(optional)</span>
                </span>
              )}
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
                rows={direct ? 3 : 2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                aria-label={direct ? 'Your request' : undefined}
                placeholder={
                  direct
                    ? 'What should Claude research for this dataset?'
                    : 'e.g. What about the Mona Lisa and other da Vinci works? — weighed against the curation rules, then added or answered.'
                }
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-sm text-[var(--color-muted)]">
                  {direct ? 'Up to how many' : 'How many to add'}
                </span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="mt-1 w-24 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <button
                onClick={() => research()}
                disabled={busy || (direct && !feedback.trim())}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                {researching ? 'Researching…' : `Research ${count} to add →`}
              </button>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              {direct
                ? 'Claude follows the request, and returns fewer than asked rather than padding. '
                : 'Claude sized this to the gaps — adjust if you like. '}
              Researched items are shown for review before anything is saved.
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {/* Claude's reply on how it handled your steer + the gaps. */}
      {note && (
        <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-wall-soft)] p-4 text-sm">
          <h4 className="mb-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">
            How your request was handled
          </h4>
          <p>{note}</p>
        </div>
      )}

      {/* Review the researched items before adding them. */}
      {pending && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="serif text-xl">
                {pending.length} researched — review before adding
              </h3>
              {/* The unfiled count is recounted from the items themselves, not taken
                  from the server's tally, so it goes down as you fix them. */}
              <CorrectionLine
                duplicates={corrections.duplicates}
                unfiled={pending.filter((p) => !p.subtopic).length}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={addToDataset}
                disabled={savingAdd || pending.length === 0}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                {savingAdd ? 'Adding…' : `Add ${pending.length} to dataset`}
              </button>
              <button
                onClick={() => {
                  forgetJob();
                  setPending(null);
                  setNote('');
                  setCorrections({ duplicates: 0, unsetSubtopics: 0 });
                }}
                disabled={savingAdd}
                className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm disabled:opacity-40"
              >
                Discard
              </button>
            </div>
          </div>

          {pending.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">
              Nothing to add — see the note above for why.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2 lg:grid-cols-3">
              {pending.map((it, i) => (
                <ReviewCard
                  key={i}
                  item={it}
                  subtopics={ds.subtopics}
                  domain={ds.domain}
                  onChange={(c) =>
                    setPending((prev) => prev && prev.map((x, j) => (j === i ? { ...x, ...c } : x)))
                  }
                  onSwapImage={() => setPickerIndex(i)}
                  onRemove={() => setPending((prev) => prev && prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {pickerIndex !== null && pending && pending[pickerIndex] && (
        <ImagePicker
          target={
            ds.domain === 'digital'
              ? {
                  kind: 'screenshot',
                  url: pending[pickerIndex].url ?? '',
                  year: pending[pickerIndex].year,
                  name: pending[pickerIndex].name,
                  imageKind: pending[pickerIndex].imageKind,
                  wikipediaTitle: pending[pickerIndex].wikipediaTitle,
                  imageQuery: pending[pickerIndex].imageQuery,
                }
              : { kind: 'search', query: physicalImageQuery(pending[pickerIndex]) }
          }
          onPick={(url) => {
            setPending(
              (prev) =>
                prev &&
                prev.map((x, j) => (j === pickerIndex ? { ...x, image: url, capture: undefined } : x)),
            );
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}

/**
 * What the server corrected in a researched batch, said plainly.
 *
 * Both numbers are things the curation prompt asks for and can't enforce — no repeats,
 * and a subtopic from the field's own list. The server fixes them either way; this is
 * so the fix isn't silent. A batch that comes back short is otherwise just a number
 * that doesn't match what you asked for, and an unfiled item is one that would save
 * happily and then never appear under any filter.
 */
function CorrectionLine({ duplicates, unfiled }: { duplicates: number; unfiled: number }) {
  if (!duplicates && !unfiled) return null;
  const parts: string[] = [];
  if (duplicates) {
    parts.push(`${duplicates} dropped as already in the set`);
  }
  if (unfiled) {
    parts.push(`${unfiled} need${unfiled === 1 ? 's' : ''} a subtopic before adding`);
  }
  return <p className="mt-0.5 text-sm text-[var(--color-muted)]">{parts.join(' · ')}</p>;
}
