/**
 * The languages two travelers have in common, minus the one everybody has.
 *
 * spotlight_score already spends up to 18 points on this — six per shared
 * language, the second-heaviest term it has, against 84 for the overlap and
 * 12 for verification — and then spends every one of them on ordering. For a
 * traveler who does not think in English it is the single fact most likely to
 * turn a card into a conversation, and it was computed on the server and
 * thrown away before it reached anybody's screen.
 *
 * English does not count, ever. On the majority of pairs it is the only
 * match, so a line that said it would be noise on most cards and would train
 * people to stop reading the row the overlap chip lives in — and where
 * something rarer IS shared, that rarer one is the whole of the news.
 *
 * Order follows the VIEWER's own list: their first language leads, which is
 * the one they would open with.
 */
export function sharedLanguages(
  mine: string[] | null | undefined,
  theirs: string[] | null | undefined
): string[] {
  if (!mine || !theirs) {
    return [];
  }
  const ours = new Set(theirs);
  return mine.filter((code) => code !== 'en' && ours.has(code));
}
