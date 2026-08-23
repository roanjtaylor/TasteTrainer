import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useNavigate, Navigate, Link, useParams, useSearchParams } from 'react-router-dom';
import {
  singleWordTopic,
  slugifyTopic,
  type Domain,
  type EraGroup,
  type ProposedItem,
  type Subtopic,
} from '../../../shared/types';
import { api } from '../lib/api';
import { createDataset, saveDataset, useDatasetList } from '../lib/data';
import { useDomain } from '../lib/domain';
import { physicalImageQuery } from '../lib/image';
import { dismissTask, finishTask, runTracked, startTask, updateTask } from '../lib/tasks';
import { currentJob, groupKey, jobsFor, refreshJobs, useJobs } from '../lib/jobs';
import { CaptureBadge, SourceTag } from '../components/CaptureBadge';
import { CandidateStrip } from '../components/CandidateStrip';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';

// Route element for both "/:domain/new" (no field chosen yet) and "/:domain/:slug/new"
// (a field's own dedicated research URL — see initialise() below for how a session
// gets moved onto one). Keyed by domain+slug so React Router's usual behaviour —
// reusing the same mounted component across a param-only navigation — can't happen
// here: starting a second field's research always mounts a fresh `Curate`, so a
// still-running call from the first can never write its result into the second's
// screen. That cross-talk (a "Bank notes" item landing under a "Lighting" session
// still on screen) was the actual bug behind "field research doesn't stack" — the
// underlying calls always ran fine in parallel, only the one shared page didn't.
export function CurateRoute() {
  const { domain, slug } = useParams();
  return <Curate key={`${domain}/${slug ?? ''}`} />;
}

// Curate flow (3-curation.md / 6-ui.md): topic -> AI subtopics -> review grid -> save.
// Scoped to the world in the URL (7-software-design.md) — this screen is /physical/new,
// or /physical/<slug>/new once a field has been named (see initialise()).
function Curate() {
  const navigate = useNavigate();
  const domain = useDomain();
  const { slug: routeSlug } = useParams();
  // The shared job cache (lib/jobs.ts): read here so opening this field's URL shows
  // whatever step of its research is current — running or finished — without a
  // detour through the notification column's button.
  const { jobs, loaded: jobsLoaded } = useJobs();

  // Arriving from the field map's "Curate this →" carries the proposed field in the
  // URL, so a gap you just read about becomes a dataset without retyping it.
  const [params, setParams] = useSearchParams();
  const [topic, setTopic] = useState(singleWordTopic(params.get('topic') ?? ''));
  const [description, setDescription] = useState(params.get('description') ?? '');
  const [count, setCount] = useState(12);

  const [subtopics, setSubtopics] = useState<Subtopic[]>([]);
  // Era-periods are decided BEFORE the items, not after saving. They become an explicit
  // per-era quota on the research call, which is what actually stops a set from
  // clustering in the era the model knows best (7-software-design.md).
  const [eraGroups, setEraGroups] = useState<EraGroup[]>([]);
  const [items, setItems] = useState<ProposedItem[]>([]);

  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState('');
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  // Dataset names are unique across the whole shelf (server: the slug column's
  // unique constraint, global not per world), so a topic that already exists can be
  // mapped and researched here and then fail at the very last step. Both worlds'
  // lists are read so the clash is caught as you type — before half an hour of
  // research is spent on it — and offers the existing dataset instead.
  const physicalList = useDatasetList('physical');
  const digitalList = useDatasetList('digital');
  const topicSlug = slugifyTopic(topic.trim());
  const existing = topicSlug
    ? [...(physicalList.data ?? []), ...(digitalList.data ?? [])].find(
        (d) => slugifyTopic(d.topic) === topicSlug,
      )
    : undefined;

  // Resuming a durable job (lib/jobs.ts) landed on from the notification gutter's
  // "View" button — `?job=<id>` carries research that already finished (or is still running) in a
  // previous session. `resuming` covers both the fetch and the poll-while-running.
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState('');
  // The job each step's CURRENT result came from, live or resumed — tracked so save()
  // can clean them up. Refs, not state: nothing on screen needs to re-render off them.
  // Two separate refs, not one: re-mapping the field after items already exist must
  // not delete the items job just because a newer subtopics job superseded the old one.
  const mapJobIdRef = useRef<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  // Guards the autostart effect below against StrictMode's dev-only double-invoke,
  // which would otherwise fire initialise() twice and create two mapping jobs for one
  // handoff.
  const autostartedRef = useRef(false);
  // Auto-resume runs once per mount, the first time the job list is known; and the
  // job a `?job=` link is already resuming, so the two paths never fetch it twice.
  const autoResumedRef = useRef(false);
  const resumedJobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const jobId = params.get('job');
    if (!jobId) return;
    // Stripped immediately so a refresh or the back button doesn't re-resume it.
    setParams((p) => { p.delete('job'); return p; }, { replace: true });
    void resumeJob(jobId);
    // `params` deliberately in the deps (not `[]`): the notification gutter's "View"
    // link points at this same `/:domain/new` route, so clicking it while already
    // sitting on this page is a query-param-only navigation — React Router reuses
    // this component instance rather than remounting it, so a mount-only effect would
    // never see the new `job` param. The `delete('job')` above makes the re-run this
    // triggers a no-op, so this can't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // Picks up a mapping call handed off by initialise() below, right after it moved
  // this session onto its own "/:domain/<slug>/new" URL. Mount-only: this instance's
  // `initialise()` is the one call that should actually run for this handoff.
  useEffect(() => {
    if (params.get('autostart') !== '1' || autostartedRef.current) return;
    autostartedRef.current = true;
    setParams((p) => { p.delete('autostart'); return p; }, { replace: true });
    void initialise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Opening this field's own URL shows its current state, the same as the notification
  // column's button would: the newest running job, else the most advanced finished one
  // (lib/jobs.ts's `currentJob`). Consistent across every way in — the gutter's link,
  // the address bar, the back button. Skipped when a `?job=` / `?autostart=` query is
  // already driving this page, or when the job is one THIS page started (its id is
  // already in a ref) — the live stream is showing it.
  useEffect(() => {
    if (!domain || !routeSlug || !jobsLoaded || autoResumedRef.current) return;
    if (params.get('job') || params.get('autostart')) return;
    autoResumedRef.current = true;
    if (busy || resumedJobIdRef.current || subtopics.length || items.length) return;
    const job = currentJob(jobsFor(jobs, `${domain}/${routeSlug}`));
    if (!job || job.id === mapJobIdRef.current || job.id === jobIdRef.current) return;
    void resumeJob(job.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsLoaded, jobs]);

  async function resumeJob(id: string) {
    resumedJobIdRef.current = id;
    setResuming(true);
    setResumeError('');
    try {
      let job = await api.getJob(id);
      while (job.status === 'running') {
        await new Promise((r) => setTimeout(r, 5000));
        job = await api.getJob(id);
      }

      // Restore whatever the job was started with even on failure — that's what makes
      // the "Retry" link from the notification gutter useful: it lands here with the
      // topic/description/subtopics already filled in, so retrying is one more button
      // press rather than retyping everything from scratch.
      if (job.kind === 'subtopics') {
        const input = job.input as { topic: string; description: string };
        setTopic(input.topic);
        setDescription(input.description);
        mapJobIdRef.current = id;
        if (job.status === 'done') {
          const result = job.result as { subtopics: Subtopic[]; suggestedCount: number; eraGroups: EraGroup[] };
          setSubtopics(result.subtopics ?? []);
          setEraGroups(result.eraGroups ?? []);
          setCount(result.suggestedCount ?? 12);
        }
      } else {
        const input = job.input as {
          topic: string;
          description: string;
          subtopics: Subtopic[];
          count: number;
          eraGroups?: EraGroup[];
        };
        setTopic(input.topic);
        setDescription(input.description);
        setSubtopics(input.subtopics ?? []);
        setEraGroups(input.eraGroups ?? []);
        setCount(input.count ?? 12);
        jobIdRef.current = id;
        if (job.status === 'done') {
          const result = job.result as { items: ProposedItem[] };
          setItems(result.items ?? []);
        }
      }

      if (job.status === 'error') {
        setResumeError(job.error ?? 'This job failed.');
      }
    } catch (e: any) {
      setResumeError(e?.message ?? 'Could not resume this job');
    } finally {
      setResuming(false);
    }
  }

  if (!domain) return <Navigate to="/" replace />;
  const dom: Domain = domain;

  async function run<T>(
    label: string,
    taskTitle: string,
    fn: (onProgress: (line: string) => void) => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(label);
    setError('');
    try {
      return await runTracked(taskTitle, (onProgress) => fn(onProgress), {
        group: groupKey(dom, topic.trim()),
        stage: label.replace(/\u2026$/, ''),
      });
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Same as `run`, for the two calls that ALSO create a durable job row server-side
   * (subtopics, items — see shared/types.ts's `Job`). Those don't need their own
   * lingering notification card once they finish: the durable job (refreshJobs(),
   * called right after this resolves) takes over as the gutter's representation of
   * this operation, with a "View"/"Retry" action the plain transient task never had.
   * Without this, the two cards sat side by side — one dead-ended on a stale
   * "Composing results…" with only a dismiss ✕, the other offering the real action.
   */
  async function runJob<T>(
    label: string,
    stage: string,
    ref: MutableRefObject<string | null>,
    fn: (onProgress: (line: string, jobId?: string) => void) => Promise<T>,
  ): Promise<T | undefined> {
    setBusy(label);
    setError('');
    // Titled and grouped by the dataset, so the gutter shows "Engines · Research"
    // with the live line under it — one card for the whole field, whichever step runs.
    const id = startTask(topic.trim(), { group: groupKey(dom, topic.trim()), stage });
    try {
      // `jobId` arrives on the first progress line: pairing the transient card with
      // the durable job keeps the gutter to one card per operation while it runs, and
      // recording it in `ref` straight away is what tells the auto-resume effect above
      // that this job is already on screen. `refreshJobs()` then pulls the new row
      // into the shared cache now, rather than after the call ends — so a second tab,
      // or the dataset's own page, sees it running immediately.
      const result = await fn((line, jobId) => {
        if (jobId && ref.current !== jobId) {
          ref.current = jobId;
          refreshJobs();
        }
        updateTask(id, line, jobId);
      });
      finishTask(id, true);
      return result;
    } catch (e: any) {
      finishTask(id, false, e?.message ?? 'Something went wrong');
      setError(e?.message ?? 'Something went wrong');
    } finally {
      dismissTask(id);
      setBusy(null);
    }
  }

  // Mapping a field means both of its axes: the subtopics it divides into, and the
  // periods its history divides into. Both are settled before any item is researched,
  // so the research call is filling a known frame rather than inventing one.
  async function initialise() {
    if (!topic.trim()) return;
    // First call for this topic: move off the shared "/:domain/new" URL onto this
    // field's own "/:domain/<slug>/new" before starting any Claude call — see
    // CurateRoute above. `autostart=1` tells the freshly-mounted instance to pick up
    // right where this one left off; that instance's own `initialise()` call is the
    // one that actually runs the job, so nothing here should run twice.
    if (!routeSlug) {
      navigate(
        `/${dom}/${slugifyTopic(topic.trim())}/new` +
          `?topic=${encodeURIComponent(topic.trim())}&description=${encodeURIComponent(description.trim())}&autostart=1`,
        { replace: true },
      );
      return;
    }
    // Re-mapping supersedes the previous map job: remember it so the old row can be
    // deleted once the new one is named (the progress callback overwrites the ref).
    const previousMapJob = mapJobIdRef.current;
    const res = await runJob('Mapping the field…', 'Map', mapJobIdRef, (onProgress) =>
      api.proposeSubtopics(topic.trim(), description.trim(), dom, onProgress),
    );
    // Unconditional, not just on success — see the matching comment in generate()
    // below: the server creates the durable job row before the Claude call, so a
    // failed call still leaves a real row for the gutter to show.
    refreshJobs();
    if (res) {
      setSubtopics(res.subtopics ?? []);
      // Claude sizes the collection to the field; the user can still override below.
      setCount(res.suggestedCount ?? 12);
      // Defensive `?? []`: `eraGroups` and `jobId` were added to this payload later
      // than `subtopics` was, and the server runs under plain `tsx` (no watch) — a
      // server process started before that change still answers with the old shape,
      // and `eraGroups.length` in the render below would then throw and blank the
      // whole page. Missing periods just mean the research call falls back to its
      // spread-across-eras behaviour, which is what it always did.
      setEraGroups(res.eraGroups ?? []);
      const jobId = res.jobId ?? null;
      if (previousMapJob && jobId && previousMapJob !== jobId) {
        api.deleteJob(previousMapJob).catch(() => {});
      }
      if (jobId) mapJobIdRef.current = jobId;
    }
  }

  async function generate(more = false) {
    // Same supersede bookkeeping as initialise(): the ref is overwritten by the
    // progress callback, so the previous job's id is taken before the call starts.
    const previousJob = jobIdRef.current;
    const res = await runJob(
      more ? 'Finding more…' : 'Researching the best…',
      'Research',
      jobIdRef,
      async (onProgress) => {
        const res = await api.generateItems(
          {
            topic: topic.trim(),
            description: description.trim(),
            subtopics,
            count,
            domain: dom,
            eraGroups,
            existingItems: more ? (items as any) : [],
          },
          onProgress,
        );
        setItems((prev) => (more ? [...prev, ...res.items] : res.items));
        return res;
      },
    );
    // Unconditional, not just on success: the server creates the durable job row
    // BEFORE the Claude call, so a research call that errors out (e.g. a 401 from a
    // misconfigured local proxy) still leaves a real `status: 'error'` row behind —
    // the SSE stream only ever reports an `error` event in that case, never a
    // `jobId`, so `res` is undefined here and the job would otherwise stay invisible
    // in the gutter until something unrelated happened to trigger a refetch (a hard
    // refresh, another job finishing elsewhere). Calling this either way means the
    // gutter picks up whatever the server actually did, success or failure.
    refreshJobs();
    if (res?.jobId) {
      // Superseding whatever job was tracked before — its proposal is already folded
      // into `items` above (or was this same job, resumed then immediately re-run),
      // so nothing is lost by forgetting it.
      if (previousJob && previousJob !== res.jobId) {
        api.deleteJob(previousJob).catch(() => {});
      }
      jobIdRef.current = res.jobId;
    }
  }

  async function save() {
    if (!description.trim()) {
      setError('A one-line description is required before saving.');
      return;
    }
    const ds = await run('Saving…', topic.trim(), async () => {
      const created = await createDataset({
        topic: topic.trim(),
        description: description.trim(),
        subtopics,
        items,
        domain: dom,
      });
      // The periods that steered the research are the ones the dataset is born with —
      // so the Era filter reads the same divisions the items were selected to fill.
      // No AI call here any more; they were settled back at "Map the field".
      if (!eraGroups.length) return created;
      try {
        return await saveDataset(created.id, { eraGroups });
      } catch {
        return created;
      }
    });
    if (ds) {
      if (mapJobIdRef.current) {
        api.deleteJob(mapJobIdRef.current).catch(() => {});
        mapJobIdRef.current = null;
      }
      if (jobIdRef.current) {
        api.deleteJob(jobIdRef.current).catch(() => {});
        jobIdRef.current = null;
      }
      navigate(`/${dom}/${slugifyTopic(ds.topic)}`);
    }
  }

  function patch(index: number, change: Partial<ProposedItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...change } : it)));
  }

  return (
    <div className="space-y-8">
      <header className="mt-4">
        <h1 className="serif text-4xl">New dataset</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          Name a field, let Claude map it and research the defining work, then review before saving.
        </p>
      </header>

      {resuming && (
        <p className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
          Picking up saved research…
        </p>
      )}
      {resumeError && <p className="text-[var(--color-accent)]">{resumeError}</p>}

      {/* "What are the fields to study?" isn't obvious — least of all in the digital
          world. This used to be a hardcoded list of 14 digital topics in TypeScript;
          the field map answers the same question for both worlds, from the model and
          from what you've already built, so it improves as the models do. */}
      {!topic.trim() && subtopics.length === 0 && (
        <section className="rounded-xl border border-[var(--color-line)] bg-[var(--color-wall-soft)] p-5">
          <p className="text-sm text-[var(--color-muted)]">
            Not sure what to study?{' '}
            <Link to={`/${dom}/review`} className="text-[var(--color-accent)] underline">
              Check this world
            </Link>{' '}
            — it maps the whole {dom} world and names the fields you don't have yet, each
            ready to start from here.
          </p>
        </section>
      )}

      {/* Step 1: the field. (No item count here — Claude sizes the collection after
          mapping the field, so the count lives in step 2 to avoid implying the user
          sets the field's structure.) */}
      <section className="space-y-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">
            Topic <span className="text-[var(--color-muted)]">(a single word, e.g. Watches)</span>
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
            value={topic}
            // Datasets are named one word — spaces are stripped as you type rather than
            // caught at save, so what you see here is always what gets saved.
            onChange={(e) => setTopic(e.target.value.replace(/\s+/g, ''))}
            placeholder={domain === 'digital' ? 'e.g. Marketplaces' : 'e.g. Watches'}
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">
            Description <span className="text-[var(--color-accent)]">(required to save)</span>
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Watches — wearable timepieces, mechanical to digital"
          />
        </label>
        {existing && (
          <p className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-wall)] px-3 py-2 text-sm text-[var(--color-accent)]">
            A <strong>{existing.topic}</strong> dataset already exists in the {existing.domain} world
            ({existing.itemCount} items) — names are unique across the shelf, so this one can't be
            saved under it.{' '}
            <Link
              to={`/${existing.domain}/${slugifyTopic(existing.topic)}`}
              className="underline"
            >
              Open it →
            </Link>{' '}
            to add to it, or pick another name.
          </p>
        )}
        <button
          onClick={initialise}
          disabled={!topic.trim() || !!busy || !!existing}
          className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)] disabled:opacity-40"
        >
          {subtopics.length ? 'Re-map field' : 'Map the field →'}
        </button>
      </section>

      {/* Step 2: subtopics */}
      {subtopics.length > 0 && (
        <section className="space-y-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
          <h2 className="serif text-2xl">Subtopics</h2>
          <p className="text-sm text-[var(--color-muted)]">
            The canonical structure items get sorted into. Edit freely.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {subtopics.map((s, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] p-3">
                <input
                  className="w-full bg-transparent font-medium outline-none"
                  value={s.name}
                  onChange={(e) =>
                    setSubtopics((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="mt-1 w-full bg-transparent text-sm text-[var(--color-muted)] outline-none"
                  value={s.description}
                  onChange={(e) =>
                    setSubtopics((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
          </div>
          {/* The field's other axis. Shown because it is now load-bearing: these
              periods become a per-era quota on the research call below, so what you
              see here is the shape the collection will actually have. */}
          {eraGroups.length > 0 && (
            <div className="pt-2">
              <h3 className="text-sm font-medium">Periods</h3>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                The items will be spread evenly across these — roughly{' '}
                {Math.max(1, Math.floor(count / eraGroups.length))} per period.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {eraGroups.map((g) => (
                  <span
                    key={`${g.label}-${g.start}`}
                    className="rounded-full border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-1 text-sm"
                  >
                    {g.label}{' '}
                    <span className="text-[var(--color-muted)]">
                      {g.start}–{g.end - 1}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <label className="block">
              <span className="text-sm text-[var(--color-muted)]">How many items</span>
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
              onClick={() => generate(false)}
              disabled={!!busy}
              className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)] disabled:opacity-40"
            >
              Research the best {count} →
            </button>
          </div>
          <p className="text-xs text-[var(--color-muted)]">
            Claude sized this to the field — adjust if you like.
          </p>
        </section>
      )}

      {error && <p className="text-[var(--color-accent)]">{error}</p>}

      {/* Step 3: review grid */}
      {items.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="serif text-2xl">Review — {items.length} items</h2>
            <div className="flex gap-2">
              <button
                onClick={() => generate(true)}
                disabled={!!busy}
                className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm disabled:opacity-40"
              >
                Ask Claude for {count} more
              </button>
              <button
                onClick={save}
                // Disabled on a name clash too (see the notice by the topic field):
                // the save would only come back with a 409. Renaming the topic
                // above re-enables it — the reviewed items save under the new name.
                disabled={!!busy || !!existing}
                title={existing ? `A ${existing.topic} dataset already exists — rename the topic to save this one.` : undefined}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                Save dataset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <ReviewCard
                key={i}
                item={it}
                subtopics={subtopics}
                domain={dom}
                onChange={(c) => patch(i, c)}
                onSwapImage={() => setPickerIndex(i)}
                onRemove={() => setItems((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </section>
      )}

      {pickerIndex !== null && (
        <ImagePicker
          target={
            dom === 'digital'
              ? {
                  kind: 'screenshot',
                  url: items[pickerIndex].url ?? '',
                  year: items[pickerIndex].year,
                  name: items[pickerIndex].name,
                  imageKind: items[pickerIndex].imageKind,
                  wikipediaTitle: items[pickerIndex].wikipediaTitle,
                  imageQuery: items[pickerIndex].imageQuery,
                }
              : { kind: 'search', query: physicalImageQuery(items[pickerIndex]) }
          }
          onPick={(url) => {
            // A hand-picked image is a deliberate choice, so the recorded capture no
            // longer describes it — clearing it retires the badge rather than leaving
            // a warning about an image that's no longer there.
            patch(pickerIndex, { image: url, capture: undefined });
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}

// Exported so the dataset view's "add what's missing" flow reviews freshly-researched
// items with the exact same card before they're saved.
export function ReviewCard({
  item,
  subtopics,
  domain,
  onChange,
  onSwapImage,
  onRemove,
}: {
  item: ProposedItem;
  subtopics: Subtopic[];
  domain?: Domain;
  onChange: (change: Partial<ProposedItem>) => void;
  onSwapImage: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
        <Photo src={item.image} alt={item.name} />
        {/* Review is the moment to catch a screenshot that isn't of the era —
            "Swap image" opens the nearby-snapshot picker. */}
        <CaptureBadge capture={item.capture} year={item.year} />
        <button
          onClick={onSwapImage}
          className="absolute bottom-2 right-2 rounded-full bg-[var(--color-ink)]/80 px-3 py-1 text-xs text-[var(--color-wall)]"
        >
          Swap image
        </button>
      </div>

      {/* Where the image came from, and — when the cascade wasn't confident — the other
          candidates it already found and scored, so correcting a poor pick is one click
          rather than a fresh manual search. */}
      <div className="flex items-center justify-between gap-2">
        <SourceTag capture={item.capture} />
      </div>
      {item.candidates?.length ? (
        <CandidateStrip
          candidates={item.candidates}
          chosen={item.image}
          onPick={(url) =>
            onChange({
              image: url,
              // Picking by hand replaces the pipeline's provenance with yours: the
              // score no longer describes this image, and a stale warning about a
              // picture you deliberately chose is worse than none.
              capture: { kind: 'reference', source: 'manual', confidence: 'high' },
            })
          }
        />
      ) : null}

      <ItemFields item={item} subtopics={subtopics} domain={domain} onChange={onChange} />

      <button onClick={onRemove} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]">
        Remove
      </button>
    </div>
  );
}
