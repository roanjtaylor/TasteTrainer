import { useEffect, useState } from 'react';

// Global task tracker: a stack of what's running right now, so a long call (importing
// an archive of likes) has somewhere to report itself other than a single inline line
// that only the page you're on can see — several of these can run at once and each
// deserves its own visible title and status rather than clobbering one shared line.

export type TaskStatus = 'running' | 'done' | 'error';

export interface Task {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  /** The verb shown under the title — "Import". */
  stage?: string;
}

export interface TaskOptions {
  stage?: string;
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
export function startTask(title: string, opts: TaskOptions = {}): string {
  const id = `t${++counter}`;
  setTasks([...tasks, { id, title, detail: '', status: 'running', ...opts }]);
  return id;
}

/** Update the live status line under a running task (e.g. "3 fields fetched"). */
export function updateTask(id: string, detail: string): void {
  setTasks(tasks.map((t) => (t.id === id ? { ...t, detail } : t)));
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
