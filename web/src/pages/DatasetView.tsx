import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { slugifyTopic } from '../../../shared/types';
import type {
  CoverageGap,
  Dataset,
  Domain,
  EraGroup,
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
import { IMAGE_ACCEPT, nameFromFile, uploadImage } from '../lib/files';
import { ItemCard } from '../components/ItemCard';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';
import { BackToTop } from '../components/BackToTop';
import { PersonalFieldEditor } from '../components/PersonalFieldEditor';
import { ReviewCard } from './Curate';
import { NavActions } from '../lib/navActions';

// The single active filter — one axis at a time (a subtopic OR an era-group), or none.
// Derived from the URL so it's shareable and back-button friendly.
type ActiveFilter =
  | { kind: 'subtopic'; name: string }
  | { kind: 'era'; group: EraGroup }
  | null;

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
      const input = job.input as { gaps?: CoverageGap[]; count?: number };
      setGaps(input.gaps ?? []);
      setGapSuggestedCount(input.count ?? 8);
      setResumeJob(job);
    } catch (e: any) {
      setGapError(e?.message ?? 'Could not resume this job');
    } finally {
      setResumingJob(false);
    }
  }

  async function whatsMissing() {
    if (!ds) return;
    setLoadingGaps(true);
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
            onClick={whatsMissing}
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
  trackJob: (id: string) => void;
  onAccepted: () => void;
  onChanged: (ds: Dataset) => void;
}) {
  // Inline editing: `editing` holds a working copy of the item being edited; `picker`
  // toggles the image swapper for it; `saving` disables the form during the write.
  const [editing, setEditing] = useState<Item | null>(null);
  const [picker, setPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  // The personal world is built by hand (9-personal-and-auth.md), so its browse view
  // doubles as the builder: add one item, drop in a batch of files, delete, and edit
  // the dataset's own shape. None of it shows in the researched worlds.
  const personal = ds.domain === 'personal';
  const [editingField, setEditingField] = useState(false);
  const [uploadError, setUploadError] = useState('');
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

  /**
   * Drop in a batch of files: each becomes an item named after its file, saved in one
   * write. Everything else about it — year, who made it, why it matters — is filled in
   * afterwards by clicking the card, because making you complete a form per photo
   * before you can see any of them is how a 200-photo import never gets finished.
   */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUploadError('');
    try {
      const updated = await runTracked(
        ds.topic,
        async (onProgress) => {
          const added: Item[] = [];
          const failed: string[] = [];
          // One at a time: a phone-sized photo is several megabytes, and a batch sent
          // in parallel mostly just contends with itself for the same uplink.
          for (const [i, file] of files.entries()) {
            onProgress(`Uploading ${i + 1} of ${files.length} — ${file.name}`);
            try {
              added.push(blankItem({ name: nameFromFile(file), image: await uploadImage(file) }));
            } catch (e: any) {
              failed.push(e?.message ?? file.name);
            }
          }
          if (failed.length) setUploadError(`Couldn’t upload: ${failed.join('; ')}`);
          if (!added.length) return null;
          onProgress(`Saving ${added.length} item${added.length === 1 ? '' : 's'}…`);
          return saveDataset(ds.id, { items: [...ds.items, ...added] });
        },
        { group: groupKey(ds.domain, ds.topic), stage: 'Upload' },
      );
      if (updated) onChanged(updated);
    } catch (e: any) {
      setUploadError(e?.message ?? 'Upload failed');
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
        trackJob={trackJob}
        onAccepted={onAccepted}
        onChanged={onChanged}
      />

      {personal && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setEditing(blankItem())}
            disabled={!!editing}
            className="rounded-full bg-[var(--color-ink)] px-4 py-1.5 text-sm text-[var(--color-wall)] disabled:opacity-40"
          >
            + Add item
          </button>
          <label className="cursor-pointer rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm hover:bg-[var(--color-wall-soft)]">
            Upload files
            <input
              type="file"
              multiple
              accept={IMAGE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                uploadFiles([...(e.target.files ?? [])]);
                // Reset, or choosing the same file twice in a row fires no change event.
                e.target.value = '';
              }}
            />
          </label>
          <button
            onClick={() => setEditingField((v) => !v)}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
          >
            Edit dataset
          </button>
          {uploadError && <span className="text-sm text-[var(--color-accent)]">{uploadError}</span>}
        </div>
      )}
      {personal && editingField && (
        <PersonalFieldEditor ds={ds} onChanged={onChanged} onClose={() => setEditingField(false)} />
      )}

      {pool.length === 0 && !isNew ? (
        <p className="text-[var(--color-muted)]">
          {personal && ds.items.length === 0
            ? 'Nothing here yet — add an item, or upload a batch of files to start the collection.'
            : 'No items in this scope.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <div key={item.id} className="relative">
                {/* The card itself opens the editor — works on touch, not just hover. */}
                <ItemCard item={item} onClick={() => setEditing({ ...item })} />
              </div>
            ),
          )}
        </div>
      )}

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
    <div className="space-y-2 rounded-xl border border-[var(--color-accent)] bg-[var(--color-card)] p-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
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
  trackJob,
  onAccepted,
  onChanged,
}: {
  ds: Dataset;
  gaps: CoverageGap[] | null;
  suggestedCount: number;
  gapError: string;
  resumeJob: Job | null;
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

  // Sync count when a new gap analysis completes with a fresh suggestion.
  useEffect(() => { setCount(suggestedCount); }, [suggestedCount]);

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
  }, [resumeJob]);

  async function research() {
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
          gaps: gaps ?? [],
          count: Math.max(1, Math.min(50, count || 8)),
          feedback,
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

  if (!gaps && !gapError) return null;

  return (
    <div className="space-y-4">
      {gapError && <p className="text-sm text-[var(--color-accent)]">{gapError}</p>}

      {gaps && (
        <div className="space-y-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-4">
          <div>
            <h3 className="serif text-lg">Coverage gaps</h3>
            {gaps.length === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">No obvious gaps — good coverage.</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-sm">
                {gaps.map((g, i) => (
                  <li key={i}>
                    <span className="text-[var(--color-accent)]">{g.axis}:</span> {g.detail}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Research & add the missing items. */}
          <div className="space-y-3 border-t border-[var(--color-line)] pt-4">
            <label className="block">
              <span className="text-sm text-[var(--color-muted)]">
                Your steer <span className="text-[var(--color-muted)]">(optional)</span>
              </span>
              <textarea
                className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm"
                rows={2}
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="e.g. What about the Mona Lisa and other da Vinci works? — weighed against the curation rules, then added or answered."
              />
            </label>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-sm text-[var(--color-muted)]">How many to add</span>
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
                onClick={research}
                disabled={busy}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                {researching ? 'Researching…' : `Research ${count} to add →`}
              </button>
            </div>
            <p className="text-xs text-[var(--color-muted)]">
              Claude sized this to the gaps — adjust if you like. Researched items are shown for
              review before anything is saved.
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
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
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
