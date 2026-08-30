/**
 * "1 traveler in this chat", not "1 travelers in this chat".
 *
 * A visible grammar error on a first-touch surface reads as carelessness
 * about everything else, and this app's whole proposition is that a stranger
 * on the other end is worth trusting.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** The count and the noun together, which is what almost every caller wants. */
export function countOf(count: number, one: string, many = `${one}s`): string {
  return `${count} ${plural(count, one, many)}`;
}

/**
 * The verb that goes with the count, for sentences that need one.
 * `countOf(1, 'person') + ' ' + isAre(1)` reads "1 person is".
 */
export function isAre(count: number): string {
  return count === 1 ? 'is' : 'are';
}
