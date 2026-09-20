import type { ReactNode } from 'react';
import { dismissTask, useTasks, type Task } from '../lib/tasks';

// The notification queue — one card per running task (lib/tasks.ts), titled by what
// it is working on, with a stage label underneath and the live progress line under
// that. Client-side and deliberately transient: gone on refresh.
//
// Mounted TWICE (main.tsx), both reading the same shared task state, each showing
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
  if (!tasks.length) return null;

  const running = tasks.filter((t) => t.status === 'running').length;

  const body = (
    <>
      {/* How much work is in flight right now — this replaced the nav bar's "N
          waiting" pill, which counted finished-but-undismissed work too and so
          read as a backlog rather than activity. */}
      {running > 0 && (
        <p className="pointer-events-auto text-center text-xs text-[var(--color-muted)] underline underline-offset-4">
          {running} running
        </p>
      )}
      {tasks.map((t) => (
        <NotificationCard key={t.id} task={t} />
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
  // lower, clearing the buttons that sit fixed in this margin's top corner.
  return (
    <div className="pointer-events-none sticky top-3 z-30 xl:top-14 hidden w-full flex-col gap-2 self-start lg:flex">
      {body}
    </div>
  );
}

function NotificationCard({ task }: { task: Task }) {
  // Both success and failure stay until dismissed — work that quietly cleared itself
  // on success was easy to miss finishing at all.
  const onDismiss = task.status === 'running' ? undefined : () => dismissTask(task.id);

  return (
    <CardShell
      title={task.title}
      stage={task.stage}
      running={task.status === 'running'}
      onDismiss={onDismiss}
    >
      {task.status === 'running' && (
        <p className="mt-1 truncate text-xs text-[var(--color-muted)]" title={task.detail}>
          {task.detail || 'Starting…'}
        </p>
      )}
      {task.status === 'error' && <p className="mt-1 text-xs text-[var(--color-accent)]">{task.detail}</p>}
      {task.status === 'done' && task.detail && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">{task.detail}</p>
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
