import {
  MUTED_WORD_MAX,
  matchesMutedWord,
  normalizeMutedWord,
  normalizeMutedWords,
} from '@/features/profile/muted-words';

/**
 * The matcher is the whole feature, and a naive one is worse than none.
 *
 * `includes()` folds "assist" and "classic" for "ass", so somebody who asked
 * not to read one word gets a hello about helping with a classic car hidden
 * behind a tap, with no explanation that would survive being read aloud. That
 * is an app censoring people, which is a bigger problem than the one this
 * solves. So: word boundaries, case insensitive, and no substring false
 * positives.
 *
 * The second half of the file is about what gets STORED. The list is keyed on
 * (user_id, word) in the database precisely so 'Ass' and 'ass ' cannot become
 * two rows that do the same thing, and the folding here is what keeps the
 * client from writing a row the check constraint would refuse.
 */

describe('matchesMutedWord', () => {
  it('finds a whole word, and says which one', () => {
    expect(matchesMutedWord('want to hook up at the night market', ['hook up'])).toBe('hook up');
    expect(matchesMutedWord('you are an ass', ['ass'])).toBe('ass');
  });

  it('does not match inside a longer word, which is the whole point', () => {
    expect(matchesMutedWord('happy to assist with the booking', ['ass'])).toBeNull();
    expect(matchesMutedWord('a classic road trip', ['ass'])).toBeNull();
    expect(matchesMutedWord('passing through on Thursday', ['ass'])).toBeNull();
    expect(matchesMutedWord('embassy run, then lunch', ['ass'])).toBeNull();
  });

  it('is case insensitive in both directions', () => {
    expect(matchesMutedWord('ASS', ['ass'])).toBe('ass');
    expect(matchesMutedWord('an Ass, frankly', ['Ass'])).toBe('ass');
  });

  it('treats punctuation and line ends as boundaries', () => {
    expect(matchesMutedWord('ass!', ['ass'])).toBe('ass');
    expect(matchesMutedWord('"ass"', ['ass'])).toBe('ass');
    expect(matchesMutedWord('ass', ['ass'])).toBe('ass');
    expect(matchesMutedWord('an\nass\nthing', ['ass'])).toBe('ass');
  });

  it('does not treat a digit or an underscore as a boundary', () => {
    expect(matchesMutedWord('ass2', ['ass'])).toBeNull();
    expect(matchesMutedWord('2ass', ['ass'])).toBeNull();
    expect(matchesMutedWord('ass_hat', ['ass'])).toBeNull();
  });

  it('keeps looking after a near miss further along the sentence', () => {
    // The first occurrence is inside "classic" and must not end the search.
    expect(matchesMutedWord('a classic trip, and you are an ass', ['ass'])).toBe('ass');
  });

  it('handles accented letters as letters rather than as boundaries', () => {
    expect(matchesMutedWord('straße', ['stra'])).toBeNull();
    expect(matchesMutedWord('the straße is long', ['straße'])).toBe('straße');
    expect(matchesMutedWord('café society', ['cafe'])).toBeNull();
  });

  it('falls back to a plain match in scripts that do not space their words', () => {
    // Chinese, Japanese, Korean and Thai put no spaces between words, so a
    // boundary rule would mean an entry in one of them could never match at
    // all. Substring is the right answer there, not a gap.
    expect(matchesMutedWord('今晚一起喝酒吗', ['喝酒'])).toBe('喝酒');
    expect(matchesMutedWord('ไปดื่มกันไหม', ['ดื่ม'])).toBe('ดื่ม');
  });

  it('matches inside a longer word in a spaced script with no letter case', () => {
    // Arabic, Hebrew and Devanagari DO space their words, so a boundary rule
    // would be right for them - and isWordChar cannot see one, because their
    // letters have no case to differ in. So a short entry there folds more
    // than it meant to. That is the half of the behaviour the screen's hint
    // exists to say out loud: "in scripts without capital letters, like
    // Arabic, Thai or Japanese, it also matches inside a longer word."
    expect(matchesMutedWord('مرحبا', ['مرح'])).toBe('مرح');
  });

  it('and matches whole words only in the scripts that do have capitals', () => {
    // The other half of the same sentence, in the two cased scripts the
    // boundary rule is not already proved on above.
    expect(matchesMutedWord('привет', ['при'])).toBeNull();
    expect(matchesMutedWord('γειά σου', ['γει'])).toBeNull();
  });

  it('answers null for an empty message, an empty list, and junk entries', () => {
    expect(matchesMutedWord('', ['ass'])).toBeNull();
    expect(matchesMutedWord('anything at all', [])).toBeNull();
    expect(matchesMutedWord('anything at all', ['   ', ''])).toBeNull();
  });

  it('returns the first word on the list that matches, folded', () => {
    expect(matchesMutedWord('Want to Hook Up?', ['party', 'HOOK UP'])).toBe('hook up');
  });
});

describe('normalizeMutedWord', () => {
  it('folds case, edges and runs of space', () => {
    expect(normalizeMutedWord('  Hook   Up  ')).toBe('hook up');
    expect(normalizeMutedWord('ASS')).toBe('ass');
  });

  it('refuses what is not a word', () => {
    expect(normalizeMutedWord('')).toBeNull();
    expect(normalizeMutedWord('    ')).toBeNull();
    expect(normalizeMutedWord('x'.repeat(MUTED_WORD_MAX + 1))).toBeNull();
  });

  it('keeps one at exactly the column ceiling', () => {
    expect(normalizeMutedWord('x'.repeat(MUTED_WORD_MAX))).toHaveLength(MUTED_WORD_MAX);
  });
});

describe('normalizeMutedWords', () => {
  it('dedupes what the primary key would have collided anyway, and sorts', () => {
    expect(normalizeMutedWords(['Ass', 'ass ', 'hook  up', '', 'party'])).toEqual([
      'ass',
      'hook up',
      'party',
    ]);
  });
});
