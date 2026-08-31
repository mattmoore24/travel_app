import {
  PRIVACY_PROMISE,
  PRIVACY_SECTIONS,
  GUIDELINE_SECTIONS,
  BUSINESS_RULE_SECTIONS,
  ZERO_TOLERANCE,
  BUSINESS_ZERO_TOLERANCE,
} from '@/constants/policies';

/**
 * The policy screens are user-facing copy under the same discipline the
 * SQL copy-lint enforces: no em dash, none of the dating-frame vocabulary.
 * The privacy sections are also the sentences App Review reads on the
 * 5.1.1(i) surface, so an empty array here is a missing policy, not a
 * styling nit.
 */

// The copy-lint pattern, spelled the same way: `unmatch` written out because
// \bmatch\b cannot see inside it.
const BANNED = /\b(swipe|deck|match|unmatch(?:ed)?|request)\b/i;
const EM_DASH = '—';

const everyLine = (sections: readonly { title: string; body: string }[]): string[] =>
  sections.flatMap((section) => [section.title, section.body]);

describe('PRIVACY_SECTIONS', () => {
  it('exists and covers the policy', () => {
    expect(PRIVACY_SECTIONS.length).toBeGreaterThanOrEqual(6);
  });

  it('names the selfie check as biometric data (decision D21)', () => {
    const all = everyLine(PRIVACY_SECTIONS).join(' ');
    expect(all).toContain('biometric');
  });

  it('says the location promise the screen is asserted on', () => {
    expect(PRIVACY_PROMISE).toContain('We never collect your location');
  });
});

describe('the policy copy obeys the copy rules', () => {
  const lines = [
    PRIVACY_PROMISE,
    ZERO_TOLERANCE,
    BUSINESS_ZERO_TOLERANCE,
    ...everyLine(PRIVACY_SECTIONS),
    ...everyLine(GUIDELINE_SECTIONS),
    ...everyLine(BUSINESS_RULE_SECTIONS),
  ];

  it('carries no em dash', () => {
    expect(lines.filter((line) => line.includes(EM_DASH))).toEqual([]);
  });

  it('carries no banned word', () => {
    expect(lines.filter((line) => BANNED.test(line))).toEqual([]);
  });
});
