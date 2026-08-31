import { blockedCopy, riskyCopy } from '@/features/matching/moderation-copy';

/**
 * The refusal can finally say which kind of wrong, so every sentence it can
 * produce is held to the brief here: no em dash, none of the dating-frame
 * vocabulary, and the two categories the blocklist actually emits must read
 * differently — a come-on told it "came across as explicit" was the bug.
 */

// Everything the blocklist's category column can hold today, plus the two
// shapes a client can see instead: null (no category returned) and a value a
// future migration might add before this file learns about it.
const CATEGORIES = ['sexual', 'flirtation', null, 'harassment'] as const;

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

  it('says a different sentence for flirtation than for sexual', () => {
    expect(copy('flirtation').body).not.toBe(copy('sexual').body);
  });

  it('keeps the generic sentence for anything it does not recognise', () => {
    expect(copy('harassment')).toEqual(copy(null));
  });

  it('never echoes a blocklist phrase back at the writer', () => {
    // The blocklist is regexes; naming the trigger hands out the evasion
    // rule. Spot-check the words the table actually matches on.
    for (const category of CATEGORIES) {
      expect(copy(category).body).not.toMatch(/\b(nudes?|dtf|fwb|sexy|hook\s*up)\b/i);
    }
  });
});

it('the two functions describe the same wrong the same way', () => {
  for (const category of ['sexual', 'flirtation'] as const) {
    expect(riskyCopy(category).body).toBe(blockedCopy(category).body);
  }
});
