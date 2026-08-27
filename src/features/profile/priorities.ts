/**
 * Top priorities: the short list of things somebody actually wants to do out
 * there.
 *
 * Every other section of a profile describes a PERSON, and trips describe a
 * PLACE AND A WINDOW. This is the only one that describes a PLAN, which is
 * why each entry is a button that opens the composer anchored to it. Nobody
 * has to be interesting; they just have to want the same thing on the same
 * days.
 */

/** Six, and the cap is the point. The database enforces it too. */
export const MAX_PRIORITIES = 6;

/**
 * Forty characters, which admits every real entry and refuses every sentence.
 * "hike the Seven Hanging Valleys" is thirty; "I really want to see the old
 * town at night" is forty-three. It is also the width that keeps a chip to at
 * most two lines at large Dynamic Type, and the chips wrap rather than
 * truncate, because half a plan is worse than no plan.
 */
export const PRIORITY_MAX = 40;

/**
 * The empty field's example, rotated by row so somebody adding six of them
 * sees six different shapes rather than the same nudge six times. Short,
 * specific, and none of them a sentence.
 */
export const PRIORITY_PLACEHOLDERS = [
  'day trip to Sintra',
  'learn to surf',
  'pastel de nata crawl',
  'find a record shop',
  'rooftop for the sunset',
  'sunrise hike',
] as const;

export function priorityPlaceholder(index: number): string {
  return PRIORITY_PLACEHOLDERS[index % PRIORITY_PLACEHOLDERS.length];
}

/**
 * What a row is allowed to be. Returns null when it is fine, otherwise the
 * message that goes under the field.
 *
 * The cap is also `maxLength` on the input, so a person can only reach the
 * "too long" branch by pasting. There is deliberately no live character
 * counter: a counter ticking toward forty invites somebody to fill it, and
 * the whole constraint exists to stop that.
 */
export function validatePriority(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return 'Write something short, or remove it.';
  }
  if (trimmed.length > PRIORITY_MAX) {
    return 'A few words is plenty.';
  }
  return null;
}
