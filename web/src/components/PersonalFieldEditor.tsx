import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { slugifyTopic, type Dataset, type Subtopic } from '../../../shared/types';
import { deleteDataset, saveDataset } from '../lib/data';
import { ConfirmDialog } from './ConfirmDialog';
import { SubtopicEditor, namedSubtopics } from './SubtopicEditor';

/** A subtopic row that remembers the name it had when the editor opened. */
type Row = Subtopic & { origin?: string };

// Editing a personal dataset's own shape — its name, description and subtopics — and
// deleting it (9-personal-and-auth.md).
//
// The researched worlds get by without this screen: Claude proposes their structure
// and the field-map review restructures it. A hand-built collection has no such
// author, and it changes the way real shelves do — "Novels" splits, a category turns
// out to be pointless — so here the structure has to stay editable for good.
export function PersonalFieldEditor({
  ds,
  onChanged,
  onClose,
}: {
  ds: Dataset;
  onChanged: (ds: Dataset) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [topic, setTopic] = useState(ds.topic);
  const [description, setDescription] = useState(ds.description);
  const [rows, setRows] = useState<Row[]>(() => ds.subtopics.map((s) => ({ ...s, origin: s.name })));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setSaving(true);
    setError('');
    try {
      // A renamed subtopic takes its items with it. Without this they'd keep the old
      // name, match no filter, and show as filed under a category that no longer exists.
      const renamed = new Map<string, string>();
      for (const row of rows) {
        const name = row.name.trim();
        if (row.origin && name && row.origin !== name) renamed.set(row.origin, name);
      }
      const updated = await saveDataset(ds.id, {
        topic: topic.trim() || ds.topic,
        description: description.trim() || ds.description,
        subtopics: namedSubtopics(rows),
        items: renamed.size
          ? ds.items.map((it) =>
              renamed.has(it.subtopic) ? { ...it, subtopic: renamed.get(it.subtopic)! } : it,
            )
          : ds.items,
      });
      onChanged(updated);
      onClose();
      // The topic is the address (/personal/books), so a rename moves the page.
      if (slugifyTopic(updated.topic) !== slugifyTopic(ds.topic)) {
        navigate(`/personal/${slugifyTopic(updated.topic)}`, { replace: true });
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not save');
      setSaving(false);
    }
  }

  async function remove() {
    setConfirmingDelete(false);
    setSaving(true);
    try {
      await deleteDataset(ds.id, ds.topic);
      navigate('/personal', { replace: true });
    } catch (e: any) {
      setError(e?.message ?? 'Could not delete');
      setSaving(false);
    }
  }

  const field =
    'mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2 text-sm';

  return (
    <div className="space-y-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-card)] p-4">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">Topic</span>
          <input
            className={field}
            value={topic}
            onChange={(e) => setTopic(e.target.value.replace(/\s+/g, ''))}
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">Description</span>
          <input className={field} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      <div>
        <h3 className="mb-2 text-sm text-[var(--color-muted)]">Subtopics</h3>
        <SubtopicEditor subtopics={rows} onChange={setRows} />
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-full bg-[var(--color-accent)] px-5 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={onClose}
          disabled={saving}
          className="rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={() => setConfirmingDelete(true)}
          disabled={saving}
          className="ml-auto text-sm text-[var(--color-muted)] hover:text-[var(--color-accent)] disabled:opacity-40"
        >
          Delete dataset
        </button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title={`Delete ${ds.topic}?`}
          body={`This removes all ${ds.items.length} items and any files you uploaded into it. It can’t be undone.`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </div>
  );
}
