import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { slugifyTopic, type Job } from '../../../shared/types';
import { dismissTask, useTasks, type Task } from '../lib/tasks';
import { cancelJob, useJobs } from '../lib/jobs';

// The single notification queue — running/finished client-side tasks (lib/tasks.ts)
// above durable, cross-refresh jobs (lib/jobs.ts), stacked together in one column.
//
// Mounted TWICE (main.tsx), both reading the same shared task/job state, each showing
// only at its own breakpoint via Tailwind's `hidden`/responsive classes — never both at
// once, just two ways of placing the same list:
//   - `overlay`: a small fixed box, top-right, for narrow windows where the content
//     column itself has no real margin beside it to place anything in.
//   - `rail`: a real CSS Grid column reserved by main.tsx alongside the content column,
//     sized declaratively by the grid rather than measured in JS. An earlier version
//     tried to measure the content column's actual edge with a ResizeObserver and
//     `position: fixed` the rail from that — it was fragile (a step behind on resize)
//     and, worse, the content column it was measuring against was itself capped at a
//     flat pixel width (`max-w-6xl`) rather than a proportion of the viewport, so on a
//     window only a little wider than that cap there was nothing left to measure at
//     all and the rail fell back to overlapping the page. A CSS Grid track can't lag
//     or overlap — it's sized in the same layout pass as everything else — and giving
//     the content column a percentage cap (main.tsx) means there's always a real
//     proportional margin for this rail to occupy, at any window width.
export function TaskNotifications({ variant }: { variant: 'overlay' | 'rail' }) {
  const tasks = useTasks();
  const { jobs } = useJobs();
  if (!tasks.length && !jobs.length) return null;

  // One card per operation. A durable call (subtopics, items, gaps, gap-fill) is
  // tracked twice while it runs — as the transient task streaming its progress here,
  // and as the durable job row the poll picks up — and the server names the job on
  // the task's first progress line (lib/tasks.ts's `jobId`) precisely so the two can
  // be paired. The transient card, which has the live line, wins while it's on
  // screen; the durable one takes over the moment the task is dismissed. Showing
  // both invited the exact mistake this guards against: the duplicate's ✕ deleted the
  // durable job mid-run, and the finished result then had no row to land in.
  const liveJobIds = new Set(tasks.map((t) => t.jobId).filter(Boolean));

  const cards = (
    <>
      {tasks.map((t) => (
        <TaskCard key={t.id} task={t} />
      ))}
      {jobs
        .filter((job) => !liveJobIds.has(job.id))
        .map((job) => (
          <JobCard key={job.id} job={job} onCancel={() => cancelJob(job.id)} />
        ))}
    </>
  );

  if (variant === 'overlay') {
    return (
      <div className="pointer-events-none fixed right-4 top-20 z-40 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 lg:hidden">
        {cards}
      </div>
    );
  }

  // `rail`: a plain grid child (main.tsx places it in the reserved right column) — no
  // `fixed`, no viewport math, no JS measurement. `sticky` keeps it in view as the
  // content column scrolls. Fills its track edge to edge — the side columns in
  // main.tsx are equal-width (so the content stays centred) and deliberately narrow,
  // and the gutters either side of this track are already halved there, so the
  // cards' width IS the column's; a cap here would just hand that width back to
  // blank margin. Titles `truncate`, so a narrow track shows their first words.
  return (
    <div className="pointer-events-none sticky top-3 z-30 hidden w-full flex-col gap-2 lg:flex">
      {cards}
    </div>
  );
}

// Shared card chrome for both a client-side task and a durable job — same border/
// padding/title treatment either way, just a different body underneath.
function CardShell({ title, onDismiss, children }: { title: string; onDismiss?: () => void; children?: ReactNode }) {
  return (
    <div className="pointer-events-auto w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3 shadow-lg">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <span className="truncate text-[13px] font-medium">{title}</span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Cancel"
            className="shrink-0 text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
          >
            ✕
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <CardShell title={task.title} onDismiss={task.status !== 'running' ? () => dismissTask(task.id) : undefined}>
      {task.detail && <p className="mt-1 text-xs text-[var(--color-muted)]">{task.detail}</p>}
    </CardShell>
  );
}

function JobCard({ job, onCancel }: { job: Job; onCancel: () => void }) {
  const input = job.input as { topic?: string };
  // 'subtopics' and 'items' are both steps of the same "new dataset" flow (Curate.tsx),
  // which resumes either kind of job via its `?job=` param — the other kinds amend an
  // existing, already-saved dataset, so they land on that dataset's own page instead.
  const reviewTo =
    job.kind === 'items' || job.kind === 'subtopics'
      ? `/${job.domain}/new?job=${job.id}`
      : `/${job.domain}/${slugifyTopic(input.topic ?? '')}?job=${job.id}`;

  // No ✕ while running, same rule as TaskCard above: the server can't stop the Claude
  // call behind a job (and now refuses to delete a running row — routes/jobs.ts), so
  // "cancel" here only ever meant "throw the result away when it lands". Once it
  // finishes or fails, ✕ genuinely dismisses it. A job that stops updating for 20
  // minutes reads as failed (storage.ts) and becomes dismissable that way.
  return (
    <CardShell title={job.title} onDismiss={job.status !== 'running' ? onCancel : undefined}>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        {job.status === 'running' && (job.progress || 'still running…')}
        {job.status === 'error' && job.error}
      </p>
      {job.status === 'done' && (
        <Link
          to={reviewTo}
          className="mt-2 inline-block rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs text-white"
        >
          View →
        </Link>
      )}
      {/* A stale/failed job still remembers what it was started with (server/storage.ts's
          rowToJob, Curate.tsx's resumeJob) — retrying is picking it back up, not
          retyping the topic from scratch. */}
      {job.status === 'error' && (
        <Link
          to={reviewTo}
          className="mt-2 inline-block rounded-full border border-[var(--color-line)] px-3 py-1 text-xs"
        >
          Retry →
        </Link>
      )}
    </CardShell>
  );
}
