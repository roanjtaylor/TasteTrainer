import { dismissTask, useTasks } from '../lib/tasks';

// The top-right stack of running/finished tasks (lib/tasks.ts) — the in-product
// replacement for a browser confirm()/alert() as the way a long AI call reports
// itself. Mounted once, globally, so it keeps showing a task across a navigation
// that happens while it's still running.
export function TaskNotifications() {
  const tasks = useTasks();
  if (!tasks.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {tasks.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3 shadow-lg"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {t.status === 'running' && (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
              )}
              {t.status === 'done' && <span className="text-sm text-[var(--color-accent)]">✓</span>}
              {t.status === 'error' && <span className="text-sm text-[var(--color-accent)]">!</span>}
              <span className="text-sm font-medium">{t.title}</span>
            </div>
            {t.status !== 'running' && (
              <button
                onClick={() => dismissTask(t.id)}
                aria-label="Dismiss"
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]"
              >
                ✕
              </button>
            )}
          </div>
          {t.detail && <p className="mt-1 text-xs text-[var(--color-muted)]">{t.detail}</p>}
        </div>
      ))}
    </div>
  );
}
