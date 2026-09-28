import { useState } from 'react';
import type { Dataset, InstagramImportStats, InstagramPostRef } from '../../../shared/types';
import { exportKind, parseInstagramExport } from '../../../shared/instagramExport';
import { api } from '../lib/api';
import { publishDataset } from '../lib/data';
import { finishTask, startTask, updateTask } from '../lib/tasks';

/** Matches the server's per-request cap (server/src/routes/instagram.ts). */
const BATCH = 250;

// Bringing your liked and saved Instagram posts into a personal dataset, from
// Instagram's data export: drop liked_posts.json and saved_posts.json in (one or both),
// and they're sent a batch at a time, saved per batch, so an interrupted run loses
// almost nothing — dropping the same files in again merges rather than duplicates.
export function InstagramImportPanel({
  ds,
  onChanged,
  onClose,
}: {
  ds: Dataset;
  onChanged: (ds: Dataset) => void;
  onClose: () => void;
}) {
  const [queued, setQueued] = useState<InstagramPostRef[]>([]);
  const [fileNote, setFileNote] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function readFiles(files: File[]) {
    setError('');
    try {
      const notes: string[] = [];
      const refs: InstagramPostRef[] = [];
      for (const f of files) {
        const kind = exportKind(f.name);
        if (!kind) {
          notes.push(`${f.name}: not liked_posts.json or saved_posts.json — skipped`);
          continue;
        }
        const found = parseInstagramExport(await f.text(), kind);
        refs.push(...found);
        notes.push(`${found.length.toLocaleString()} ${kind} posts in ${f.name}`);
      }
      setQueued(refs);
      setFileNote(notes.join(' · ') || 'No posts found in those files.');
    } catch {
      setQueued([]);
      setFileNote('Couldn’t read that file — it should be liked_posts.json or saved_posts.json from your Instagram export.');
    }
  }

  async function run() {
    setRunning(true);
    setError('');
    const total: InstagramImportStats = { added: 0, merged: 0, skipped: 0 };
    const taskId = startTask(ds.topic, { stage: 'Import' });
    try {
      for (let at = 0; at < queued.length; at += BATCH) {
        const line = `Importing ${Math.min(at + BATCH, queued.length).toLocaleString()} of ${queued.length.toLocaleString()}…`;
        setProgress(line);
        updateTask(taskId, line);
        const { dataset, stats } = await api.importInstagram(ds.id, queued.slice(at, at + BATCH));
        for (const k of Object.keys(total) as (keyof InstagramImportStats)[]) total[k] += stats[k];
        // Published per batch, so the wall fills in behind the panel as it goes.
        publishDataset(dataset);
        onChanged(dataset);
      }
      const summary = summarise(total);
      setProgress(summary);
      finishTask(taskId, true, summary);
      setQueued([]);
      setFileNote('');
    } catch (e: any) {
      const message = e?.message ?? 'Import failed';
      setError(`${message} — what was imported before this is saved; run it again to continue.`);
      finishTask(taskId, false, message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4">
      <div>
        <h3 className="serif text-lg">Import Instagram</h3>
        <p className="text-sm text-[var(--color-muted)]">
          Every post you liked or saved, ordered by when it was posted. A post in both files becomes
          one card. Already-imported posts are merged, not repeated, so it’s safe to run twice.
        </p>
      </div>

      <label className="block">
        <span className="text-sm text-[var(--color-muted)]">
          From your Instagram export: <code>your_instagram_activity/likes/liked_posts.json</code> and{' '}
          <code>saved/saved_posts.json</code> — one or both
        </span>
        <input
          type="file"
          multiple
          accept=".json,application/json"
          disabled={running}
          className="mt-1 block w-full text-sm"
          onChange={(e) => readFiles([...(e.target.files ?? [])])}
        />
        {fileNote && <span className="mt-1 block text-xs text-[var(--color-muted)]">{fileNote}</span>}
      </label>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {progress && <p className="text-sm text-[var(--color-muted)]">{progress}</p>}

      <div className="flex gap-2">
        <button
          onClick={run}
          disabled={running || queued.length === 0}
          className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
        >
          {running ? 'Importing…' : `Import ${queued.length ? queued.length.toLocaleString() : ''} →`}
        </button>
        <button
          onClick={onClose}
          disabled={running}
          className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm disabled:opacity-40"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function summarise(s: InstagramImportStats): string {
  const parts = [`${s.added} new card${s.added === 1 ? '' : 's'}`];
  if (s.merged) parts.push(`${s.merged} merged into cards already here`);
  if (s.skipped) parts.push(`${s.skipped} links couldn’t be read`);
  return `Done: ${parts.join(' · ')}.`;
}
