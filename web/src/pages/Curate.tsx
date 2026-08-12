import { useEffect, useRef, useState } from 'react';
import { useNavigate, Navigate, Link, useSearchParams } from 'react-router-dom';
import {
  singleWordTopic,
  slugifyTopic,
  type Domain,
  type EraGroup,
  type ProposedItem,
  type Subtopic,
} from '../../../shared/types';
import { api } from '../lib/api';
import { createDataset, saveDataset } from '../lib/data';
import { useDomain } from '../lib/domain';
import { physicalImageQuery } from '../lib/image';
import { runTracked } from '../lib/tasks';
import { CaptureBadge, SourceTag } from '../components/CaptureBadge';
import { CandidateStrip } from '../components/CandidateStrip';
import { ImagePicker } from '../components/ImagePicker';
import { Photo } from '../components/Photo';
import { ItemFields } from '../components/ItemFields';

// Curate flow (3-curation.md / 6-ui.md): topic -> AI subtopics -> review grid -> save.
// Scoped to the world in the URL (7-software-design.md) — this screen is /physical/new.
export function Curate() {
  const navigate = useNavigate();
  const domain = useDomain();

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

  // Resuming a durable job (lib/jobs.ts) landed on from the ResumeBanner/Nav badge —
  // `?job=<id>` carries research that already finished (or is still running) in a
  // previous session. `resuming` covers both the fetch and the poll-while-running.
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState('');
  // The job the CURRENT proposal came from, live or resumed — tracked so save() can
  // clean it up. A ref, not state: nothing on screen needs to re-render off it.
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const jobId = params.get('job');
    if (!jobId) return;
    // Stripped immediately so a refresh or the back button doesn't re-resume it.
    setParams((p) => { p.delete('job'); return p; }, { replace: true });
    void resumeJob(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resumeJob(id: string) {
    setResuming(true);
    setResumeError('');
    try {
      let job = await api.getJob(id);
      while (job.status === 'running') {
        await new Promise((r) => setTimeout(r, 5000));
        job = await api.getJob(id);
      }
      if (job.status === 'error') {
        setResumeError(job.error ?? 'This job failed.');
        return;
      }
      const input = job.input as {
        topic: string;
        description: string;
        subtopics: Subtopic[];
        count: number;
        eraGroups?: EraGroup[];
      };
      const result = job.result as { items: ProposedItem[] };
      setTopic(input.topic);
      setDescription(input.description);
      setSubtopics(input.subtopics ?? []);
      setEraGroups(input.eraGroups ?? []);
      setCount(input.count ?? 12);
      setItems(result.items ?? []);
      jobIdRef.current = id;
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
      return await runTracked(taskTitle, (onProgress) => fn(onProgress));
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  // Mapping a field means both of its axes: the subtopics it divides into, and the
  // periods its history divides into. Both are settled before any item is researched,
  // so the research call is filling a known frame rather than inventing one.
  async function initialise() {
    if (!topic.trim()) return;
    await run('Mapping the field…', `Map the ${topic.trim()} field`, async (onProgress) => {
      const res = await api.proposeSubtopics(topic.trim(), description.trim(), dom, onProgress);
      setSubtopics(res.subtopics);
      // Claude sizes the collection to the field; the user can still override below.
      setCount(res.suggestedCount);

      // Best-effort: without periods the research call falls back to its old
      // spread-across-eras behaviour rather than failing the whole flow.
      try {
        const periods = await api.generatePeriods(
          { topic: topic.trim(), description: description.trim(), domain: dom },
          onProgress,
        );
        setEraGroups(periods.eraGroups);
      } catch {
        setEraGroups([]);
      }
    });
  }

  async function generate(more = false) {
    const res = await run(
      more ? 'Finding more…' : 'Researching the best…',
      more ? `Find more for ${topic.trim()}` : `Research the ${topic.trim()} dataset`,
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
    if (res?.jobId) {
      // Superseding whatever job was tracked before — its proposal is already folded
      // into `items` above (or was this same job, resumed then immediately re-run),
      // so nothing is lost by forgetting it.
      if (jobIdRef.current && jobIdRef.current !== res.jobId) {
        api.deleteJob(jobIdRef.current).catch(() => {});
      }
      jobIdRef.current = res.jobId;
    }
  }

  async function save() {
    if (!description.trim()) {
      setError('A one-line description is required before saving.');
      return;
    }
    const ds = await run('Saving…', `Save ${topic.trim()} dataset`, async () => {
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
        <button
          onClick={initialise}
          disabled={!topic.trim() || !!busy}
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
                disabled={!!busy}
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
