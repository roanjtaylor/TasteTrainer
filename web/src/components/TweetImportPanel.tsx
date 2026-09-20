import { useState } from 'react';
import type { Dataset, LikedTweetRef, TweetImportStats } from '../../../shared/types';
import { api } from '../lib/api';
import { publishDataset } from '../lib/data';
import { finishTask, startTask, updateTask } from '../lib/tasks';
import { groupKey } from '../lib/jobs';

/** Matches the server's per-request cap (server/src/routes/tweets.ts). */
const BATCH = 50;

/**
 * The X data archive's data/like.js: a JS assignment, not JSON —
 * `window.YTD.like.part0 = [ { like: { tweetId, fullText, expandedUrl } }, … ]`.
 * Everything from the first "[" is the JSON. A big archive splits into like-part1.js
 * and so on, which is why several files can be chosen at once.
 */
function parseLikeFile(source: string): LikedTweetRef[] {
  const start = source.indexOf('[');
  if (start < 0) return [];
  const rows = JSON.parse(source.slice(start)) as { like?: { tweetId?: string; fullText?: string } }[];
  return rows
    .map((r) => ({ id: String(r.like?.tweetId ?? ''), text: r.like?.fullText }))
    .filter((l) => /^\d+$/.test(l.id));
}

/** Tweet links (x.com/…/status/123) or bare ids, in any surrounding text. */
function parseLinks(source: string): LikedTweetRef[] {
  const ids = [...source.matchAll(/status(?:es)?\/(\d+)/g)].map((m) => m[1]);
  const bare = source.split(/\s+/).filter((w) => /^\d{5,25}$/.test(w));
  return [...new Set([...ids, ...bare])].map((id) => ({ id }));
}

// Bringing liked tweets into a personal dataset: the archive's like.js for the whole
// history at once, or pasted links for a few by hand. Both end in the same server call,
// sent a batch at a time so progress is real and an interrupted run loses almost
// nothing — importing the same file again skips what's in and retries what failed.
export function TweetImportPanel({
  ds,
  onChanged,
  onClose,
}: {
  ds: Dataset;
  onChanged: (ds: Dataset) => void;
  onClose: () => void;
}) {
  const [fromFile, setFromFile] = useState<LikedTweetRef[]>([]);
  const [fileNote, setFileNote] = useState('');
  const [links, setLinks] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function readFiles(files: File[]) {
    setError('');
    try {
      const likes = (await Promise.all(files.map((f) => f.text()))).flatMap(parseLikeFile);
      setFromFile(likes);
      setFileNote(
        likes.length
          ? `${likes.length.toLocaleString()} likes found`
          : 'No likes found in that file — it should be data/like.js from your X archive.',
      );
    } catch {
      setFromFile([]);
      setFileNote('Couldn’t read that file — it should be data/like.js from your X archive.');
    }
  }

  const queued = [...fromFile, ...parseLinks(links)];

  async function run() {
    setRunning(true);
    setError('');
    const total: TweetImportStats = { added: 0, merged: 0, skipped: 0, unavailable: 0, failed: 0 };
    const taskId = startTask(ds.topic, { group: groupKey(ds.domain, ds.topic), stage: 'Import' });
    try {
      for (let at = 0; at < queued.length; at += BATCH) {
        const line = `Importing ${Math.min(at + BATCH, queued.length).toLocaleString()} of ${queued.length.toLocaleString()}…`;
        setProgress(line);
        updateTask(taskId, line);
        const { dataset, stats } = await api.importTweets(ds.id, queued.slice(at, at + BATCH));
        for (const k of Object.keys(total) as (keyof TweetImportStats)[]) total[k] += stats[k];
        // Published per batch, so the wall fills in behind the panel as it goes.
        publishDataset(dataset);
        onChanged(dataset);
      }
      const summary = summarise(total);
      setProgress(summary);
      finishTask(taskId, true, summary);
      setFromFile([]);
      setFileNote('');
      setLinks('');
    } catch (e: any) {
      const message = e?.message ?? 'Import failed';
      setError(`${message} — what was imported before this is saved; run it again to continue.`);
      finishTask(taskId, false, message);
    } finally {
      setRunning(false);
    }
  }

  const field =
    'mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm';

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-4">
      <div>
        <h3 className="serif text-lg">Import tweets</h3>
        <p className="text-sm text-[var(--color-muted)]">
          Each liked tweet is saved with the thread above it; likes from the same thread become
          one card. Already-imported tweets are skipped, so it’s safe to run twice.
        </p>
      </div>

      <label className="block">
        <span className="text-sm text-[var(--color-muted)]">
          Your X archive’s <code>data/like.js</code> — your whole history of likes
        </span>
        <input
          type="file"
          multiple
          accept=".js,.json,application/javascript,application/json"
          disabled={running}
          className="mt-1 block w-full text-sm"
          onChange={(e) => readFiles([...(e.target.files ?? [])])}
        />
        {fileNote && <span className="mt-1 block text-xs text-[var(--color-muted)]">{fileNote}</span>}
      </label>

      <label className="block">
        <span className="text-sm text-[var(--color-muted)]">…or paste tweet links, one or many</span>
        <textarea
          className={field}
          rows={3}
          value={links}
          disabled={running}
          onChange={(e) => setLinks(e.target.value)}
          placeholder="https://x.com/paulg/status/1732772125436482014"
        />
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

function summarise(s: TweetImportStats): string {
  const parts = [`${s.added} new card${s.added === 1 ? '' : 's'}`];
  if (s.merged) parts.push(`${s.merged} folded into existing threads`);
  if (s.skipped) parts.push(`${s.skipped} already here`);
  if (s.unavailable) parts.push(`${s.unavailable} deleted on X (kept from the archive’s text)`);
  if (s.failed) parts.push(`${s.failed} couldn’t be fetched — import again to retry them`);
  return `Done: ${parts.join(' · ')}.`;
}
