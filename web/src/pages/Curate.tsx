import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ProposedItem, Subtopic } from '../../../shared/types';
import { api } from '../lib/api';
import { ImagePicker } from '../components/ImagePicker';

// Curate flow (3-curation.md / 6-ui.md): topic -> AI subtopics -> review grid -> save.
export function Curate() {
  const navigate = useNavigate();

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [count, setCount] = useState(12);

  const [subtopics, setSubtopics] = useState<Subtopic[]>([]);
  const [items, setItems] = useState<ProposedItem[]>([]);

  const [busy, setBusy] = useState<null | string>(null);
  const [error, setError] = useState('');
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError('');
    try {
      return await fn();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  async function initialise() {
    if (!topic.trim()) return;
    await run('Mapping the field…', async () => {
      const res = await api.proposeSubtopics(topic.trim(), description.trim());
      setSubtopics(res.subtopics);
    });
  }

  async function generate(more = false) {
    await run(more ? 'Finding more…' : 'Researching the best…', async () => {
      const res = await api.generateItems({
        topic: topic.trim(),
        description: description.trim(),
        subtopics,
        count,
        existingItems: more ? (items as any) : [],
      });
      setItems((prev) => (more ? [...prev, ...res.items] : res.items));
    });
  }

  async function save() {
    if (!description.trim()) {
      setError('A one-line description is required before saving.');
      return;
    }
    const ds = await run('Saving…', () =>
      api.createDataset({ topic: topic.trim(), description: description.trim(), subtopics, items }),
    );
    if (ds) navigate(`/dataset/${ds.id}`);
  }

  function patch(index: number, change: Partial<ProposedItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...change } : it)));
  }

  return (
    <div className="space-y-8">
      <header className="mt-4">
        <h1 className="serif text-4xl">New dataset</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          Name a field, let Claude map it and research the defining work, then review before saving.
        </p>
      </header>

      {/* Step 1: the field */}
      <section className="space-y-4 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-[var(--color-muted)]">Topic</span>
            <input
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. Watches"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[var(--color-muted)]">How many items</span>
            <input
              type="number"
              min={1}
              max={50}
              className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm text-[var(--color-muted)]">
            Description <span className="text-[var(--color-accent)]">(required to save)</span>
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Watches — wearable timepieces, mechanical to digital"
          />
        </label>
        <button
          onClick={initialise}
          disabled={!topic.trim() || !!busy}
          className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)] disabled:opacity-40"
        >
          {subtopics.length ? 'Re-map field' : 'Map the field →'}
        </button>
      </section>

      {/* Step 2: subtopics */}
      {subtopics.length > 0 && (
        <section className="space-y-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-5">
          <h2 className="serif text-2xl">Subtopics</h2>
          <p className="text-sm text-[var(--color-muted)]">
            The canonical structure items get sorted into. Edit freely.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {subtopics.map((s, i) => (
              <div key={i} className="rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] p-3">
                <input
                  className="w-full bg-transparent font-medium outline-none"
                  value={s.name}
                  onChange={(e) =>
                    setSubtopics((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="mt-1 w-full bg-transparent text-sm text-[var(--color-muted)] outline-none"
                  value={s.description}
                  onChange={(e) =>
                    setSubtopics((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <button
            onClick={() => generate(false)}
            disabled={!!busy}
            className="rounded-full bg-[var(--color-ink)] px-5 py-2 text-sm text-[var(--color-wall)] disabled:opacity-40"
          >
            Research the best {count} →
          </button>
        </section>
      )}

      {busy && <p className="text-[var(--color-accent)]">{busy}</p>}
      {error && <p className="text-[var(--color-accent)]">{error}</p>}

      {/* Step 3: review grid */}
      {items.length > 0 && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="serif text-2xl">Review — {items.length} items</h2>
            <div className="flex gap-2">
              <button
                onClick={() => generate(true)}
                disabled={!!busy}
                className="rounded-full border border-[var(--color-line)] px-4 py-2 text-sm disabled:opacity-40"
              >
                Ask Claude for {count} more
              </button>
              <button
                onClick={save}
                disabled={!!busy}
                className="rounded-full bg-[var(--color-accent)] px-5 py-2 text-sm text-white disabled:opacity-40"
              >
                Save dataset
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {items.map((it, i) => (
              <ReviewCard
                key={i}
                item={it}
                subtopics={subtopics}
                onChange={(c) => patch(i, c)}
                onSwapImage={() => setPickerIndex(i)}
                onRemove={() => setItems((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        </section>
      )}

      {pickerIndex !== null && (
        <ImagePicker
          initialQuery={`${items[pickerIndex].name} ${items[pickerIndex].brand}`.trim()}
          onPick={(url) => {
            patch(pickerIndex, { image: url });
            setPickerIndex(null);
          }}
          onClose={() => setPickerIndex(null)}
        />
      )}
    </div>
  );
}

function ReviewCard({
  item,
  subtopics,
  onChange,
  onSwapImage,
  onRemove,
}: {
  item: ProposedItem;
  subtopics: Subtopic[];
  onChange: (change: Partial<ProposedItem>) => void;
  onSwapImage: () => void;
  onRemove: () => void;
}) {
  const field = 'w-full rounded border border-[var(--color-line)] bg-[var(--color-wall)] px-2 py-1 text-sm';
  return (
    <div className="space-y-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-card)] p-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[var(--color-wall-soft)]">
        {item.image ? (
          <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-[var(--color-muted)]">
            needs image
          </div>
        )}
        <button
          onClick={onSwapImage}
          className="absolute bottom-2 right-2 rounded-full bg-[var(--color-ink)]/80 px-3 py-1 text-xs text-[var(--color-wall)]"
        >
          Swap image
        </button>
      </div>

      <input className={field + ' font-medium'} value={item.name} onChange={(e) => onChange({ name: e.target.value })} />
      <div className="flex gap-2">
        <input
          className={field}
          type="number"
          value={item.year ?? ''}
          placeholder="year"
          onChange={(e) => onChange({ year: e.target.value ? Number(e.target.value) : null })}
        />
        <select
          className={field}
          value={item.subtopic}
          onChange={(e) => onChange({ subtopic: e.target.value })}
        >
          <option value="">subtopic…</option>
          {subtopics.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex gap-2">
        <input className={field} value={item.brand} placeholder="brand" onChange={(e) => onChange({ brand: e.target.value })} />
        <input className={field} value={item.creator} placeholder="creator" onChange={(e) => onChange({ creator: e.target.value })} />
      </div>
      <textarea
        className={field}
        rows={2}
        value={item.description}
        placeholder="why it's great"
        onChange={(e) => onChange({ description: e.target.value })}
      />
      <textarea
        className={field}
        rows={2}
        value={item.definingFact}
        placeholder="defining fact"
        onChange={(e) => onChange({ definingFact: e.target.value })}
      />
      <button onClick={onRemove} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-accent)]">
        Remove
      </button>
    </div>
  );
}
