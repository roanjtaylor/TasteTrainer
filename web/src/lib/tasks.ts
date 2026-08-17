import { useEffect, useState } from 'react';

// Global task tracker: a top-right stack of what's running right now, so a long AI
// call (accepting a map change, expanding a dataset) has somewhere to report itself
// other than a single inline line that only the page you're on can see — several of
// these can run at once (a boundary fix per card, an expand plus a review) and each
// deserves its own visible title and status rather than clobbering one shared line.

export type TaskStatus = 'running' | 'done' | 'error';

export interface Task {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  /** The durable job row (lib/jobs.ts) this task is the live view of, once the
   *  server has told us its id — so the notification gutter shows ONE card for the
   *  operation, not this transient one beside the durable one. */
  jobId?: string;
}

let tasks: Task[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function notify(): void {
  listeners.forEach((l) => l());
}

function setTasks(next: Task[]): void {
  tasks = next;
  notify();
}

/** Start tracking a task; returns an id to report progress/completion against. */
export function startTask(title: string): string {
  const id = `t${++counter}`;
  setTasks([...tasks, { id, title, detail: '', status: 'running' }]);
  return id;
}

/** Update the live status line under a running task (e.g. "3 fields fetched"), and
 *  record the durable job it belongs to once the server names one. Shaped to be
 *  passed straight through as an `OnProgress` (lib/api.ts): `(line, jobId?)`. */
export function updateTask(id: string, detail: string, jobId?: string): void {
  setTasks(tasks.map((t) => (t.id === id ? { ...t, detail, jobId: jobId ?? t.jobId } : t)));
}

/** Mark a task finished. Both success and failure stay on screen until the user
 *  dismisses them — a task that quietly cleared itself on success was easy to miss
 *  finishing at all. */
export function finishTask(id: string, ok: boolean, detail = ''): void {
  setTasks(tasks.map((t) => (t.id === id ? { ...t, status: ok ? 'done' : 'error', detail: detail || t.detail } : t)));
}

export function dismissTask(id: string): void {
  setTasks(tasks.filter((t) => t.id !== id));
}

/**
 * Wrap an async action as a tracked task: `title` is the card's heading for as long
 * as it runs, `onProgress` feeds the line underneath it, success clears the card after
 * a beat, and a thrown error surfaces on the card instead of being swallowed silently.
 */
export async function runTracked<T>(
  title: string,
  fn: (onProgress: (detail: string, jobId?: string) => void) => Promise<T>,
): Promise<T> {
  const id = startTask(title);
  try {
    const result = await fn((detail, jobId) => updateTask(id, detail, jobId));
    finishTask(id, true);
    return result;
  } catch (e: any) {
    finishTask(id, false, e?.message ?? 'Something went wrong');
    throw e;
  }
}

export function useTasks(): Task[] {
  const [snapshot, setSnapshot] = useState(tasks);
  useEffect(() => {
    const listener = () => setSnapshot(tasks);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return snapshot;
}
