import { useEffect, useState } from 'react';
import { slugifyTopic, type Domain, type Job, type JobKind } from '../../../shared/types';
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
/** True once the first fetch has answered — so a page deciding whether to resume a
 *  dataset's job on open (Curate) can tell "no job" from "not asked yet". */
let loaded = false;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setTimeout> | undefined;

function notify(): void {
  listeners.forEach((l) => l());
}

async function fetchAll(): Promise<void> {
  try {
    // Rows of a retired kind (the old per-dataset review/expand jobs) may still sit in
    // the table; nothing can open them any more, so they are never shown.
    jobs = (await api.listJobs()).filter((j) => j.kind in JOB_STAGE);
    loaded = true;
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
export function useJobs(domain?: Domain): { jobs: Job[]; loaded: boolean; refresh: () => void } {
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
    loaded,
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

// ---- Grouping: one dataset, many steps ----
//
// A dataset moves through stages — map → research (Curate.tsx) — and each stage is
// its own durable job row. To the user those
// are ONE thing happening to ONE dataset, so everything that shows jobs (the
// notification gutter, a page deciding what to resume on open) keys them by dataset
// and picks a single "current" job per key.

/** "physical/engines" — the dataset a job or task belongs to. Every job kind stores
 *  the topic in its input (server/src/routes/curation.ts passes `req.body` through). */
export function groupKey(domain: Domain, topic: string): string {
  return `${domain}/${slugifyTopic(topic)}`;
}

export function jobGroupKey(job: Job): string {
  const input = job.input as { topic?: string };
  return groupKey(job.domain, input.topic ?? '');
}

/** The stage label for a card: the verb the step is doing. */
export const JOB_STAGE: Record<JobKind, string> = {
  subtopics: 'Map',
  items: 'Research',
};

/** Later stages supersede earlier ones: an 'items' job's input carries the subtopics
 *  it was researched against, so the later job is self-sufficient to resume from and
 *  the earlier one is just history. (Curate.tsx deletes the earlier row outright once
 *  the later step's result is saved.) */
const STAGE_RANK: Record<JobKind, number> = { subtopics: 0, items: 1 };

/**
 * The one job that represents a dataset right now, out of every row keyed to it:
 * anything still running wins (it's the live thing), else the most advanced stage,
 * newest first within a stage. `null` when the dataset has no job at all.
 */
export function currentJob(jobsForKey: Job[]): Job | null {
  if (!jobsForKey.length) return null;
  return [...jobsForKey].sort((a, b) => {
    const ar = a.status === 'running' ? 1 : 0;
    const br = b.status === 'running' ? 1 : 0;
    if (ar !== br) return br - ar;
    if (STAGE_RANK[a.kind] !== STAGE_RANK[b.kind]) return STAGE_RANK[b.kind] - STAGE_RANK[a.kind];
    return b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0;
  })[0];
}

/** Every job for one dataset. */
export function jobsFor(all: Job[], key: string): Job[] {
  return all.filter((j) => jobGroupKey(j) === key);
}

/** Where "View" lands for a job: both kinds are steps of the same "new dataset" flow
 *  (Curate.tsx), which resumes either via its `?job=` param on the field's own
 *  research URL. */
export function jobReviewPath(job: Job): string {
  const input = job.input as { topic?: string };
  const slug = slugifyTopic(input.topic ?? '');
  return `/${job.domain}/${slug}/new?job=${job.id}`;
}
