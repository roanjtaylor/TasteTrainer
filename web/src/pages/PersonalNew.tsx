import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { slugifyTopic, type Subtopic } from '../../../shared/types';
import { createDataset, useDatasetList } from '../lib/data';
import { SubtopicEditor, namedSubtopics } from '../components/SubtopicEditor';

// Starting a personal dataset (9-personal-and-auth.md) — /personal/new, and the only
// "new dataset" screen left in the app.
//
// The researched worlds don't need one: a field there is named, mapped and filled by
// asking Claude in the dock, and the map's gaps are the way in. Here neither half is
// Claude's to do — what your collection divides into, and what is in it, are things
// only you know. So this is one short form that makes an EMPTY dataset, and the adding
// happens inside it (DatasetView), where you can see the collection take shape as you
// drop files in.
export function PersonalNew() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [subtopics, setSubtopics] = useState<Subtopic[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Names are unique across the WHOLE shelf, every world (the slug column's unique
  // constraint), so a personal "Watches" collides with the physical one. Caught as
  // you type rather than as a 409 on save.
  const lists = [useDatasetList('physical'), useDatasetList('digital'), useDatasetList('personal')];
  const topicSlug = slugifyTopic(topic.trim());
  const existing = topicSlug
    ? lists.flatMap((l) => l.data ?? []).find((d) => slugifyTopic(d.topic) === topicSlug)
    : undefined;

  async function create() {
    setSaving(true);
    setError('');
    try {
      const ds = await createDataset({
        topic: topic.trim(),
        description: description.trim(),
        subtopics: namedSubtopics(subtopics),
        items: [],
        domain: 'personal',
      });
      navigate(`/personal/${slugifyTopic(ds.topic)}`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not create the dataset');
      setSaving(false);
    }
  }

  const field =
    'mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2';

  return (
    <div className="space-y-8">
      <header className="mt-4">
        <h1 className="serif text-4xl">New personal dataset</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          Name a collection of your own — then fill it with your files, one playlist at a time.
        </p>
      </header>

      <section className="space-y-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">Topic (a single word, e.g. Books)</span>
          <input
            className={field}
            value={topic}
            // One word, as dataset names are everywhere else.
            onChange={(e) => setTopic(e.target.value.replace(/\s+/g, ''))}
            placeholder="e.g. Books, Films, Albums, Memories"
          />
        </label>
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">Description</span>
          <input
            className={field}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Books — the ones that changed how I think"
          />
        </label>
        {existing && (
          <p className="rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-wall)] px-3 py-2 text-sm text-[var(--color-accent)]">
            A <strong>{existing.topic}</strong> dataset already exists in the {existing.domain} world —
            names are unique across the shelf.{' '}
            <Link to={`/${existing.domain}/${slugifyTopic(existing.topic)}`} className="underline">
              Open it →
            </Link>{' '}
            or pick another name.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
        <h2 className="serif text-2xl">Subtopics</h2>
        <p className="text-sm text-[var(--color-muted)]">
          How the collection divides — what you’ll filter within. Optional, and editable
          later.
        </p>
        <SubtopicEditor subtopics={subtopics} onChange={setSubtopics} />
      </section>

      {error && <p className="text-[var(--color-accent)]">{error}</p>}

      <button
        onClick={create}
        disabled={saving || !topic.trim() || !description.trim() || !!existing}
        className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
      >
        {saving ? 'Creating…' : 'Create dataset →'}
      </button>
    </div>
  );
}
