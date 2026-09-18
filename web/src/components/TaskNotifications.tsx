import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Job } from '../../../shared/types';
import { dismissTask, useTasks, type Task } from '../lib/tasks';
import { cancelJob, currentJob, JOB_STAGE, jobGroupKey, jobReviewPath, useJobs } from '../lib/jobs';

// The single notification queue — one card per DATASET, not one per AI call.
//
// Two sources feed it: running/finished client-side tasks (lib/tasks.ts, gone on
// refresh) and durable, cross-refresh jobs (lib/jobs.ts). Both carry the dataset
// they belong to (`task.group` / `jobGroupKey`), and everything sharing a key is
// folded into a single card titled with the dataset's name, a stage label underneath
// (Map → Research, or Review → Expand), and ONE status slot that changes over time:
// the live progress line while the step runs, then the button that opens it for
// review once it's done. That replaces a stack of separate "Map Engines" /
// "Research Engines" / "Expand Engines" cards that each had to be noticed and
// dismissed on its own — the user asked for "the dataset names as the title, the
// state as a label, and the status as it updates or the button to view it".
//
// Ungrouped tasks (a world-map redraw, a boundary fix, a save) stay as standalone
// cards under their own title — they aren't steps in a dataset's pipeline.
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
  const cards = buildCards(tasks, jobs);
  if (!cards.length) return null;

  const running = cards.filter((c) => c.status === 'running').length;

  const body = (
    <>
      {/* How much AI work is in flight right now — this replaced the nav bar's "N
          waiting" pill, which counted every finished-but-undismissed job too and so
          read as a backlog rather than activity. */}
      {running > 0 && (
        <p className="pointer-events-auto text-center text-xs text-[var(--color-muted)] underline underline-offset-4">
          {running} running
        </p>
      )}
      {cards.map((c) => (
        <NotificationCard key={c.key} card={c} />
      ))}
    </>
  );

  if (variant === 'overlay') {
    return (
      <div className="pointer-events-none fixed right-4 top-20 z-40 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 lg:hidden">
        {body}
      </div>
    );
  }

  // `rail`: a plain grid child (main.tsx places it in the reserved right column) — no
  // `fixed`, no viewport math, no JS measurement. `sticky` keeps it in view as the
  // content column scrolls. `self-start` is what makes the sticky actually work: the
  // parent is a flex container stretched to the full height of the grid row, and a
  // flex child defaults to `align-self: stretch` — a sticky element as tall as its
  // container has nowhere to slide to, which is why the cards used to scroll away
  // with the page. Pinned to its own height, it stays at `top-3` like the dataset
  // title on the left. Fills its track edge to edge — the side columns in main.tsx
  // are equal-width (so the content stays centred) and deliberately narrow, and the
  // gutters either side of this track are already halved there, so the cards' width
  // IS the column's; a cap here would just hand that width back to blank margin.
  // Titles `truncate`, so a narrow track shows their first words. From `xl` it sticks
  // lower, clearing the settings cog that sits fixed in this margin's top corner.
  return (
    <div className="pointer-events-none sticky top-3 z-30 xl:top-14 hidden w-full flex-col gap-2 self-start lg:flex">
      {body}
    </div>
  );
}

// ---- Model: one card per dataset ----

type CardStatus = 'running' | 'done' | 'error';

interface Card {
  key: string;
  /** The dataset's name for a grouped card; the task's own title otherwise. */
  title: string;
  /** "Map" / "Research" / "Review" / "Expand" — absent on a standalone task. */
  stage?: string;
  status: CardStatus;
  /** The live line while running, or the error text. */
  detail: string;
  /** The durable job the card's action (View / Retry) points at, if any. */
  job: Job | null;
  /** Everything ✕ should clear — every transient task and every finished job that was
   *  folded into this card. */
  taskIds: string[];
  jobIds: string[];
}

/**
 * Folds tasks and jobs into cards, newest-activity first. A durable call is tracked
 * twice while it runs — as the transient task streaming its progress, and as the
 * durable job row the poll picks up — and both land in the same dataset's card, where
 * the task's live line wins over the job's (up to 15s stale) polled one. That pairing
 * is also what stops the old mistake this file guards against: two cards for one
 * operation, where the duplicate's ✕ deleted the durable job mid-run and the finished
 * result then had no row to land in.
 */
function buildCards(tasks: Task[], jobs: Job[]): Card[] {
  const cards = new Map<string, Card>();

  // Durable jobs first, grouped by dataset, one "current" job each.
  const byKey = new Map<string, Job[]>();
  for (const job of jobs) {
    const key = jobGroupKey(job);
    byKey.set(key, [...(byKey.get(key) ?? []), job]);
  }
  for (const [key, group] of byKey) {
    const job = currentJob(group)!;
    const input = job.input as { topic?: string };
    cards.set(key, {
      key,
      title: input.topic ?? job.title,
      stage: JOB_STAGE[job.kind],
      status: job.status,
      detail: job.status === 'error' ? job.error ?? 'Something went wrong' : job.progress || 'still running…',
      job,
      taskIds: [],
      // Only rows that can actually be deleted: the server refuses to delete a running
      // one (routes/jobs.ts), and ✕ isn't offered while anything in the card runs.
      jobIds: group.filter((j) => j.status !== 'running').map((j) => j.id),
    });
  }

  // Then transient tasks: into their dataset's card if they have one, standalone if not.
  for (const task of tasks) {
    const key = task.group ?? `task:${task.id}`;
    const existing = cards.get(key);
    if (!existing) {
      cards.set(key, {
        key,
        title: task.title,
        stage: task.stage,
        status: task.status,
        detail: task.detail,
        job: null,
        taskIds: [task.id],
        jobIds: [],
      });
      continue;
    }
    existing.taskIds.push(task.id);
    if (task.status === 'running') {
      // The live stream is the freshest word on what's happening — and the stage it
      // names is the one the user just started, even if an older job for the same
      // dataset is still the durable "current" until the new row is fetched.
      existing.status = 'running';
      existing.stage = task.stage ?? existing.stage;
      existing.detail = task.detail || existing.detail;
    } else if (task.status === 'error' && existing.status !== 'running') {
      existing.status = 'error';
      existing.detail = task.detail || existing.detail;
    }
  }

  // Running work at the top, then whatever finished most recently.
  return [...cards.values()].sort((a, b) => {
    const ar = a.status === 'running' ? 1 : 0;
    const br = b.status === 'running' ? 1 : 0;
    if (ar !== br) return br - ar;
    const au = a.job?.updatedAt ?? '';
    const bu = b.job?.updatedAt ?? '';
    return bu < au ? -1 : bu > au ? 1 : 0;
  });
}

// ---- View ----

function NotificationCard({ card }: { card: Card }) {
  const { job } = card;
  // No ✕ while running: the server can't stop the Claude call behind a job (and
  // refuses to delete a running row — routes/jobs.ts), so "cancel" here only ever
  // meant "throw the result away when it lands". Once it finishes or fails, ✕
  // genuinely dismisses the whole dataset's card. A job that stops updating for 20
  // minutes reads as failed (storage.ts) and becomes dismissable that way.
  const onDismiss =
    card.status === 'running'
      ? undefined
      : () => {
          card.taskIds.forEach(dismissTask);
          card.jobIds.forEach((id) => void cancelJob(id));
        };

  // What the button does depends on the stage: a map or a gap review is just
  // "look at it"; research and expansion produce a proposal that needs accepting.
  const actionLabel =
    job && (job.kind === 'items' || job.kind === 'gap-fill') ? 'Review & accept →' : 'View →';

  return (
    <CardShell title={card.title} stage={card.stage} running={card.status === 'running'} onDismiss={onDismiss}>
      {card.status === 'running' && (
        <p className="mt-1 truncate text-xs text-[var(--color-muted)]" title={card.detail}>
          {card.detail || 'Starting…'}
        </p>
      )}
      {card.status === 'error' && <p className="mt-1 text-xs text-[var(--color-accent)]">{card.detail}</p>}
      {card.status === 'done' && job && (
        <Link
          to={jobReviewPath(job)}
          className="mt-2 inline-block rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs text-white"
        >
          {actionLabel}
        </Link>
      )}
      {card.status === 'done' && !job && card.detail && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{card.detail}</p>
      )}
      {/* A stale/failed job still remembers what it was started with (server/storage.ts's
          rowToJob, Curate.tsx's resumeJob) — retrying is picking it back up, not
          retyping the topic from scratch. */}
      {card.status === 'error' && job && (
        <Link
          to={jobReviewPath(job)}
          className="mt-2 inline-block rounded-full border border-[var(--color-line)] px-3 py-1 text-xs"
        >
          Retry →
        </Link>
      )}
    </CardShell>
  );
}

function CardShell({
  title,
  stage,
  running,
  onDismiss,
  children,
}: {
  title: string;
  stage?: string;
  running: boolean;
  onDismiss?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="pointer-events-auto w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3 shadow-lg">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            {running && (
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
            )}
            <span className="truncate text-[13px] font-medium" title={title}>
              {title}
            </span>
          </div>
          {stage && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">{stage}</span>
          )}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
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
