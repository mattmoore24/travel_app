import { sharedLanguages } from '@/features/matching/shared-language';

/**
 * spotlight_score spends up to 18 points on a shared language — six each, the
 * second-heaviest term it has after the 84 for the date overlap — and then
 * spends every one of them on ordering. This is that fact, kept.
 *
 * The English rule is the whole design. It is the only match on most pairs,
 * so a line that said it would be noise on the majority of cards and would
 * teach people to skip the row the overlap chip lives in.
 */
describe('a language two travelers share', () => {
  it('names the one that is not English', () => {
    expect(sharedLanguages(['pt', 'en'], ['en', 'pt'])).toEqual(['pt']);
  });

  it('drops English even when something rarer is shared too', () => {
    // The rarer one is the whole of the news, and the card prints one line.
    expect(sharedLanguages(['pt', 'en', 'es'], ['pt', 'en', 'es'])).toEqual(['pt', 'es']);
  });

  it('says nothing when English is all there is', () => {
    expect(sharedLanguages(['en'], ['en'])).toEqual([]);
    expect(sharedLanguages(['en', 'de'], ['en', 'fr'])).toEqual([]);
  });

  it('says nothing when either side has no languages at all', () => {
    expect(sharedLanguages(null, ['pt'])).toEqual([]);
    expect(sharedLanguages(['pt'], null)).toEqual([]);
    expect(sharedLanguages(undefined, undefined)).toEqual([]);
    expect(sharedLanguages([], ['pt'])).toEqual([]);
  });

  it('says nothing when they share none', () => {
    expect(sharedLanguages(['pt'], ['ja'])).toEqual([]);
  });

  it("follows the viewer's own order, so the line leads with their first", () => {
    // The card prints only the first result, and the one a viewer would open
    // with is the one at the top of their own list.
    expect(sharedLanguages(['es', 'pt'], ['pt', 'es'])).toEqual(['es', 'pt']);
    expect(sharedLanguages(['pt', 'es'], ['pt', 'es'])).toEqual(['pt', 'es']);
  });
});
