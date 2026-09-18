import type { Subtopic } from '../../../shared/types';

// Hand-editing a field's subtopics — the personal world's stand-in for "Map the field"
// (9-personal-and-auth.md). In the researched worlds Claude proposes this list; here
// there is nobody to ask what your own shelves divide into, so you type it.
//
// Rows are keyed by index, not by name: a name is being edited, so it can't also be
// the key. Generic so a caller can hang its own bookkeeping on a row and get it back
// untouched — PersonalFieldEditor tags each row with the name it started as, which is
// how a rename can be carried through to the items filed under it.
export function SubtopicEditor<T extends Subtopic>({
  subtopics,
  onChange,
}: {
  subtopics: T[];
  onChange: (next: T[]) => void;
}) {
  function patch(index: number, change: Partial<Subtopic>) {
    onChange(subtopics.map((s, i) => (i === index ? { ...s, ...change } : s)));
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {subtopics.map((s, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-wall)] p-3"
          >
            <div className="min-w-0 flex-1">
              <input
                className="w-full bg-transparent font-medium outline-none placeholder:font-normal placeholder:text-[var(--color-muted)]"
                value={s.name}
                placeholder="Name, e.g. Novels"
                onChange={(e) => patch(i, { name: e.target.value })}
              />
              <input
                className="mt-1 w-full bg-transparent text-sm text-[var(--color-muted)] outline-none"
                value={s.description}
                placeholder="What belongs here (optional)"
                onChange={(e) => patch(i, { description: e.target.value })}
              />
            </div>
            <button
              onClick={() => onChange(subtopics.filter((_, j) => j !== i))}
              aria-label={`Remove ${s.name || 'subtopic'}`}
              className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={() => onChange([...subtopics, { name: '', description: '' } as T])}
        className="rounded-full border border-dashed border-[var(--color-line)] px-4 py-1.5 text-sm text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      >
        + Add subtopic
      </button>
    </div>
  );
}

/** Drop the rows left blank — an unnamed subtopic can't be filtered by or filed under. */
export function namedSubtopics(subtopics: Subtopic[]): Subtopic[] {
  return subtopics
    .map((s) => ({ name: s.name.trim(), description: s.description.trim() }))
    .filter((s) => s.name);
}
