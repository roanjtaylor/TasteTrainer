// Data hygiene for model-proposed items.
//
// The curation prompts ASK for these two things — "do NOT repeat these" and "subtopic
// MUST be exactly one of these names" — and a prompt is not a guarantee. Both failures
// are silent: a repeat becomes a second copy of the same work with a fresh id, and an
// off-list subtopic becomes an item that no subtopic filter can ever reach. Neither is
// visible on the review grid, so nothing catches them before they're saved.
//
// This is the enforcement half. It is deliberately code and not more prompt text.
import type { Item, ProposedItem, Subtopic } from '../../../shared/types.ts';

/**
 * The comparison key for "is this the same work?".
 *
 * Diacritics, punctuation, casing, articles and the trailing parenthetical a model
 * likes to add ("Guernica (1937)") are all noise here — they're the shapes a repeat
 * actually arrives in. What's left is compared exactly.
 */
function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an) /, '');
}

/** Case- and space-insensitive key for matching a subtopic to its canonical spelling. */
function subtopicKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface HygieneResult {
  items: ProposedItem[];
  /** Proposals dropped as repeats of an existing item or of an earlier proposal. */
  duplicates: number;
  /** Proposals whose subtopic was off-list and has been cleared for the reviewer to set. */
  unsetSubtopics: number;
}

/**
 * Drop repeats and pin subtopics to the field's canonical list.
 *
 * Matching is on NAME alone, within one field. Two items in a single field sharing a
 * name are near-always the same work described twice, and the cost of the rare wrong
 * drop (one proposal missing from a batch you're about to review anyway) is far below
 * the cost of the common wrong keep (a duplicate saved into the set for good).
 *
 * A subtopic that differs only in case or spacing is corrected to the canonical
 * spelling. One that isn't on the list at all is CLEARED rather than guessed at: the
 * review grid's dropdown then reads "subtopic…", which is the truth — the model put
 * this item somewhere the field doesn't have — and the count comes back so the UI can
 * say so out loud instead of leaving it to be noticed.
 */
export function cleanProposals(
  proposed: ProposedItem[],
  existingItems: Item[],
  subtopics: Subtopic[],
): HygieneResult {
  const seen = new Set(existingItems.map((i) => nameKey(i.name ?? '')));
  const canonical = new Map(subtopics.map((s) => [subtopicKey(s.name), s.name]));

  const items: ProposedItem[] = [];
  let duplicates = 0;
  let unsetSubtopics = 0;

  for (const raw of proposed) {
    const key = nameKey(raw.name ?? '');
    if (key && seen.has(key)) {
      duplicates++;
      continue;
    }
    // An unnamed proposal is kept and not counted against anything: it has no key to
    // match on, and the review grid's name field makes it a visibly broken card the
    // reviewer can fill in or remove. Dropping it here would be the silent kind of
    // handling this module exists to replace.
    if (key) seen.add(key);

    const match = canonical.get(subtopicKey(raw.subtopic ?? ''));
    if (!match && (raw.subtopic ?? '') !== '') unsetSubtopics++;
    items.push({ ...raw, subtopic: match ?? '' });
  }

  return { items, duplicates, unsetSubtopics };
}

/**
 * Correct an item's subtopic to the canonical spelling where one matches.
 *
 * Used on every write (routes/datasets.ts), not just the curated paths, because a
 * case-drifted subtopic is invisible until a filter quietly returns nothing. Unmatched
 * values are left ALONE here — unlike the proposal path above, this runs over items
 * already in the set, where clearing a value because the subtopic list has since been
 * renamed would destroy data rather than flag it.
 */
export function canonicalSubtopic(value: string, subtopics: Subtopic[]): string {
  if (!value) return value;
  const match = subtopics.find((s) => subtopicKey(s.name) === subtopicKey(value));
  return match ? match.name : value;
}
