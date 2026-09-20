// Data hygiene for model-proposed items.
//
// The curation prompts ASK for these two things — "do NOT repeat these" and "subtopic
// MUST be exactly one of these names" — and a prompt is not a guarantee. Both failures
// are silent: a repeat becomes a second copy of the same work with a fresh id, and an
// off-list subtopic becomes an item that no subtopic filter can ever reach. Neither is
// visible on the review grid, so nothing catches them before they're saved.
//
// This is the enforcement half. It is deliberately code and not more prompt text.
import type { Subtopic } from '../../../shared/types.ts';

/**
 * The comparison key for "is this the same work?".
 *
 * Diacritics, punctuation, casing, articles and the trailing parenthetical a model
 * likes to add ("Guernica (1937)") are all noise here — they're the shapes a repeat
 * actually arrives in. What's left is compared exactly.
 */
export function nameKey(name: string): string {
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

/**
 * Correct an item's subtopic to the canonical spelling where one matches.
 *
 * Used on every write (routes/datasets.ts), not just the curated paths, because a
 * case-drifted subtopic is invisible until a filter quietly returns nothing. Unmatched
 * values are left ALONE here — this runs over items already in
 * the set, where clearing a value because the subtopic list has since been
 * renamed would destroy data rather than flag it.
 */
export function canonicalSubtopic(value: string, subtopics: Subtopic[]): string {
  if (!value) return value;
  const match = subtopics.find((s) => subtopicKey(s.name) === subtopicKey(value));
  return match ? match.name : value;
}
