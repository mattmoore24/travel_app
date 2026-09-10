import { blockedCopy, riskyCopy } from '@/features/matching/moderation-copy';

/**
 * The refusal says which kind of wrong, and since 2026-09-10 there is one
 * kind: a slur. Founder: "a few explicit curse words that are almost always
 * used in a derogatory fashion ... and can rely on users to report/block each
 * other." So every sentence here is held to the brief (no em dash, none of
 * the dating-frame vocabulary), the slur sentence must differ from the
 * generic one, and NONE of them may say "explicit" any more, because nothing
 * is refused for being explicit.
 */

// Everything the blocklist's category column can hold today, plus the two
// shapes a client can see instead: null (no category returned) and a value a
// future migration might add before this file learns about it.
const CATEGORIES = ['slur', null, 'harassment'] as const;

const BANNED = /\b(swipe|deck|match|request)\b/i;

describe.each([
  ['blockedCopy', blockedCopy],
  ['riskyCopy', riskyCopy],
])('%s', (_name, copy) => {
  it.each(CATEGORIES.map((c) => [c] as const))('category %s obeys the brief', (category) => {
    const { title, body } = copy(category);
    for (const text of [title, body]) {
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain('—');
      expect(text).not.toMatch(BANNED);
    }
  });

  it('says a different sentence for a slur than for anything else', () => {
    expect(copy('slur').body).not.toBe(copy(null).body);
  });

  it('keeps the generic sentence for anything it does not recognise', () => {
    expect(copy('harassment')).toEqual(copy(null));
  });

  it('no longer tells anybody their message was explicit', () => {
    // Flirtation and sex are not refused since 2026-09-10; a sentence that
    // still said so would be describing a rule that is gone.
    for (const category of CATEGORIES) {
      expect(copy(category).body).not.toMatch(/explicit|come-on/i);
    }
  });

  it('never echoes a blocklist word back at the writer', () => {
    // The blocklist is regexes; naming the trigger hands out the evasion
    // rule. The founder's own exemplar is the one to check.
    for (const category of CATEGORIES) {
      expect(copy(category).body).not.toMatch(/\bn+i+g+/i);
    }
  });
});

it('the two functions describe a slur the same way', () => {
  expect(riskyCopy('slur').body).toBe(blockedCopy('slur').body);
});
