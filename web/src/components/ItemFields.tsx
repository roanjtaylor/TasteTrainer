import type { Domain, Subtopic } from '../../../shared/types';

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
  url?: string;
}

// One minimalist form for editing an item's fields, reused wherever an item is
// edited so the look and behaviour stay consistent. `domain` adds a url field for
// digital-world items (7-software-design.md) — the address the screenshot pipeline
// captures — hidden in the physical world, where it has no meaning.
//
// The personal world (9-personal-and-auth.md) keeps the SAME fields and only rewords
// the prompts: a book has an author and a publisher where a watch has a designer and a
// brand, and "why it's great" is the wrong question to ask of a family photo. Same
// shape underneath is what lets personal datasets be browsed and filtered by code
// that never learns they're different.
const PROMPTS = {
  default: {
    url: 'url (e.g. https://stripe.com)',
    brand: 'brand',
    creator: 'creator',
    description: "why it's great",
    definingFact: 'defining fact',
  },
  personal: {
    url: 'link (optional — where it lives: Spotify, Letterboxd, Goodreads…)',
    brand: 'publisher / studio / label',
    creator: 'author / director / artist',
    description: 'why it matters to you',
    definingFact: 'a memory or note',
  },
};
export function ItemFields({
  item,
  subtopics,
  domain,
  onChange,
}: {
  item: EditableItem;
  subtopics: Subtopic[];
  domain?: Domain;
  onChange: (change: Partial<EditableItem>) => void;
}) {
  const prompts = domain === 'personal' ? PROMPTS.personal : PROMPTS.default;
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
      {(domain === 'digital' || domain === 'personal') && (
        <input
          className={field}
          value={item.url ?? ''}
          placeholder={prompts.url}
          onChange={(e) => onChange({ url: e.target.value })}
        />
      )}
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
          placeholder={prompts.brand}
          onChange={(e) => onChange({ brand: e.target.value })}
        />
        <input
          className={field}
          value={item.creator}
          placeholder={prompts.creator}
          onChange={(e) => onChange({ creator: e.target.value })}
        />
      </div>
      <textarea
        className={field}
        rows={2}
        value={item.description}
        placeholder={prompts.description}
        onChange={(e) => onChange({ description: e.target.value })}
      />
      <textarea
        className={field}
        rows={2}
        value={item.definingFact}
        placeholder={prompts.definingFact}
        onChange={(e) => onChange({ definingFact: e.target.value })}
      />
    </div>
  );
}
