import { useEffect, useState } from 'react';
import type { Domain, Job } from '../../../shared/types';
import { api } from './api';

// The durable half of curation progress — deliberately separate from lib/tasks.ts,
// which is the transient, memory-only `TaskNotifications` toast tracker (gone on
// refresh by design). This one is backed by Supabase (server/src/storage.ts's job
// functions) precisely so it ISN'T gone on refresh: it's what the resume banner and
// the Nav badge read to show AI work that finished, or is still running, while nobody
// was watching.

/** Every job for one world, or across both when `domain` is omitted (the Nav badge's
 *  case). Fetches on mount and polls every 15s only while something is still
 *  `running` — a finished/failed list has nothing left to change on its own. */
export function useJobs(domain?: Domain): { jobs: Job[]; refresh: () => void } {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const next = await api.listJobs(domain);
        if (cancelled) return;
        setJobs(next);
        if (next.some((j) => j.status === 'running')) {
          timer = setTimeout(tick, 15_000);
        }
      } catch {
        // Best-effort — a failed poll just tries again next time something asks.
      }
    }
    tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [domain]);

  return { jobs, refresh: () => api.listJobs(domain).then(setJobs).catch(() => {}) };
}
