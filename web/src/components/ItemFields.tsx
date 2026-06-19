import type { Subtopic } from '../../../shared/types';

// The editable fields shared by a proposed item (Curate review grid) and a saved
// item (dataset edit). Both Item and ProposedItem carry this subset.
export interface EditableItem {
  name: string;
  description: string;
  year: number | null;
  brand: string;
  creator: string;
  definingFact: string;
  subtopic: string;
}

// One minimalist form for editing an item's fields, reused wherever an item is
// edited so the look and behaviour stay consistent.
export function ItemFields({
  item,
  subtopics,
  onChange,
}: {
  item: EditableItem;
  subtopics: Subtopic[];
  onChange: (change: Partial<EditableItem>) => void;
}) {
  const field =
    'w-full rounded border border-[var(--color-line)] bg-[var(--color-wall)] px-2 py-1 text-sm';
  return (
    <div className="space-y-2">
      <input
        className={field + ' font-medium'}
        value={item.name}
        placeholder="name"
        onChange={(e) => onChange({ name: e.target.value })}
      />
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
        <input
          className={field}
          value={item.brand}
          placeholder="brand"
          onChange={(e) => onChange({ brand: e.target.value })}
        />
        <input
          className={field}
          value={item.creator}
          placeholder="creator"
          onChange={(e) => onChange({ creator: e.target.value })}
        />
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
    </div>
  );
}
