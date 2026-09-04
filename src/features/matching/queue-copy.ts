/**
 * The scope line at the top of the Travelers queue.
 *
 * A reading screen needs scope: nothing used to say whether there were four
 * people in Bangkok on your dates or four hundred, so the screen felt like an
 * endless feed you must keep feeding. The count is of the QUEUE — already
 * filtered by passes, existing chats, hellos sent and the viewer's own
 * audience setting — never of everyone in the city, which is why the words
 * say "on your dates" rather than claiming the city's population.
 */
export function remainingLine(n: number, where: string | null): string {
  if (n <= 0) {
    return 'Last one for now';
  }
  const scope = where ? ` ${where}` : '';
  if (n === 1) {
    return `One more on your dates${scope}`;
  }
  return `${n} more on your dates${scope}`;
}
