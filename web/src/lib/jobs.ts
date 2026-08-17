import { useEffect, useState } from 'react';
import type { Domain, Job } from '../../../shared/types';
import { api } from './api';

// The durable half of curation progress — deliberately separate from lib/tasks.ts,
// which is the transient, memory-only `TaskNotifications` toast tracker (gone on
// refresh by design). This one is backed by Supabase (server/src/storage.ts's job
// functions) precisely so it ISN'T gone on refresh: it's what the notification gutter
// and the Nav badge read to show AI work that finished, or is still running, while
// nobody was watching.
//
// A single shared cache (not one fetch per hook instance) so every mounted `useJobs`
// — the gutter, unscoped; Nav's badge, unscoped — reads the same list. Without that,
// cancelling a job in the gutter only updated ITS OWN local state; the Nav badge kept
// counting the cancelled job until its own poll happened to land minutes later.

let jobs: Job[] = [];
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setTimeout> | undefined;

function notify(): void {
  listeners.forEach((l) => l());
}

async function fetchAll(): Promise<void> {
  try {
    jobs = await api.listJobs();
    notify();
  } catch {
    // Best-effort — a failed poll just tries again next time something asks.
  }
}

/** Polls only while a component is actually mounted, and only while something in the
 *  fetched set is still `running` — a finished/failed list has nothing left to change
 *  on its own. */
function schedulePoll(): void {
  if (pollTimer) return;
  const tick = async () => {
    pollTimer = undefined;
    await fetchAll();
    if (listeners.size > 0 && jobs.some((j) => j.status === 'running')) {
      pollTimer = setTimeout(tick, 15_000);
    }
  };
  pollTimer = setTimeout(tick, 15_000);
}

/** Every job for one world, or across both when `domain` is omitted (the Nav badge's
 *  and the notification gutter's case). */
export function useJobs(domain?: Domain): { jobs: Job[]; refresh: () => void } {
  const [, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((t) => t + 1);
    const firstListener = listeners.size === 0;
    listeners.add(listener);
    if (firstListener) {
      void fetchAll().then(() => {
        if (jobs.some((j) => j.status === 'running')) schedulePoll();
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    jobs: domain ? jobs.filter((j) => j.domain === domain) : jobs,
    refresh: () => {
      void fetchAll();
    },
  };
}

/** Pulls a freshly created job into the shared cache right away, instead of waiting
 *  for a mounted `useJobs` consumer's next poll (or its very first mount, which is the
 *  only other time a fetch happens). Call this immediately after capturing a new
 *  `jobId` from any call that creates a durable job — otherwise a job started from a
 *  page that isn't polling yet finishes invisibly: it completes and saves correctly on
 *  the server, but nothing on screen ever learns it exists. */
export function refreshJobs(): void {
  void fetchAll().then(() => {
    if (jobs.some((j) => j.status === 'running')) schedulePoll();
  });
}

/** Cancels a job and removes it from the shared cache immediately — every mounted
 *  `useJobs` (the gutter, the Nav badge) drops it in the same render, rather than
 *  waiting for each one's own next poll. */
export async function cancelJob(id: string): Promise<void> {
  try {
    await api.deleteJob(id);
  } catch {
    // The server refuses to delete a job that's genuinely still running (409) — the
    // gutter hides ✕ on those, but the list can be a poll behind reality. Re-fetch so
    // the card shows its true state instead of vanishing and reappearing next poll.
    void fetchAll();
    return;
  }
  jobs = jobs.filter((j) => j.id !== id);
  notify();
}
