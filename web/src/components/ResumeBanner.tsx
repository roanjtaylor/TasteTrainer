import { Link } from 'react-router-dom';
import { slugifyTopic, type Domain, type Job } from '../../../shared/types';
import { api } from '../lib/api';
import { useJobs } from '../lib/jobs';

// What's left over from a Claude call nobody stuck around to see finish (or fail) —
// the point of the whole durable-job layer (lib/jobs.ts). Sits at the top of the
// per-world shelf (pages/Home.tsx) since a job is domain-scoped; the Nav badge is the
// cross-domain heads-up that something like this exists at all.
//
// `topic` narrows it to one dataset's own jobs — DatasetView mounts it that way so a
// 'gaps' sweep or a 'gap-fill' research call queued for THIS field is still visible
// (and resumable) right here after a refresh, not just from the world shelf.
export function ResumeBanner({ domain, topic }: { domain: Domain; topic?: string }) {
  const { jobs: allJobs, refresh } = useJobs(domain);
  const jobs = topic
    ? allJobs.filter((j) => (j.input as { topic?: string } | null)?.topic === topic)
    : allJobs;
  if (jobs.length === 0) return null;

  function dismiss(id: string) {
    api.deleteJob(id).finally(refresh);
  }

  return (
    <div className="mb-4 space-y-2">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} onDismiss={() => dismiss(job.id)} />
      ))}
    </div>
  );
}

function JobRow({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const input = job.input as { topic?: string };
  const reviewTo =
    job.kind === 'items'
      ? `/${job.domain}/new?job=${job.id}`
      : `/${job.domain}/${slugifyTopic(input.topic ?? '')}?job=${job.id}`;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] px-4 py-3 text-sm">
      <div className="flex items-center gap-2">
        {job.status === 'running' && (
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--color-accent)]" />
        )}
        <span>
          {job.title}
          {job.status === 'done' && (
            <span className="text-[var(--color-muted)]"> — ready to review</span>
          )}
          {job.status === 'running' && (
            <span className="text-[var(--color-muted)]"> — {job.progress || 'still running…'}</span>
          )}
          {job.status === 'error' && (
            <span className="text-[var(--color-accent)]"> — {job.error}</span>
          )}
        </span>
      </div>
      <div className="flex shrink-0 gap-2">
        {job.status === 'done' && (
          <Link
            to={reviewTo}
            className="rounded-full bg-[var(--color-accent)] px-4 py-1.5 text-xs text-white"
          >
            Review →
          </Link>
        )}
        <button
          onClick={onDismiss}
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-xs text-[var(--color-muted)] hover:bg-[var(--color-wall-soft)]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
