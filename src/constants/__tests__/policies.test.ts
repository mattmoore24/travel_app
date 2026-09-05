import fs from 'node:fs';
import path from 'node:path';

import {
  PRIVACY_PROMISE,
  PRIVACY_SECTIONS,
  GUIDELINE_SECTIONS,
  BUSINESS_RULE_SECTIONS,
  ZERO_TOLERANCE,
  BUSINESS_ZERO_TOLERANCE,
  SAFETY_PROMISE_BODY,
  SAFETY_PROMISE_TITLE,
  SIGN_UP_GATE_NOTE,
  SOCIALS_HIDDEN_NOTE,
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

/**
 * The bodies of the tour pages the safety page sits beside, read out of
 * src/features/intro/intro-tour.tsx.
 *
 * Source-read rather than imported: intro-tour is a Reanimated screen, and
 * pulling it into a constants test to measure three strings costs a mock of
 * half the animation stack. The safety page's own body is the imported
 * constant, not a quoted literal, so this regex excludes it from its own
 * bound automatically.
 */
const tourSiblingBodies = (): string[] => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'features', 'intro', 'intro-tour.tsx'),
    'utf8'
  );
  const from = source.indexOf('const PAGES: Page[] = [');
  const to = source.indexOf('\n];', from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return [...source.slice(from, to).matchAll(/body: (['"])((?:\\.|(?!\1).)*)\1/g)].map(
    (match) => match[2]
  );
};

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

describe('the four safety promises, where they decide something', () => {
  /**
   * The reason a cautious traveler picks this over GAFFL, Couchsurfing or
   * Bumble BFF: no location, pins that expire within 72 hours, socials hidden
   * until both sides chat, first messages screened. All four are enforced in
   * Postgres and all four used to live only in the fourth section of a
   * rulebook behind a button nobody opens.
   */
  it('says the location promise where somebody decides to install', () => {
    expect(SAFETY_PROMISE_TITLE).toBe('We never ask where you are');
    expect(SIGN_UP_GATE_NOTE).toContain('we never ask where you are');
    // Still an invitation, not a warning: the gate's headline contract.
    expect(SIGN_UP_GATE_NOTE).toContain('Always free');
  });

  it('names the pin expiry and the socials gate, the two enforced rules', () => {
    expect(SAFETY_PROMISE_BODY).toContain('72 hours');
    expect(SAFETY_PROMISE_BODY).toContain('both chatting');
    expect(SOCIALS_HIDDEN_NOTE).toContain('hidden until you are both chatting');
  });

  it('says the same things the house rules say, so the two cannot drift', () => {
    const privacy = GUIDELINE_SECTIONS.find((section) => section.title === 'Your privacy');
    expect(privacy).toBeDefined();
    expect(privacy?.body).toContain('We never collect your location');
    expect(privacy?.body).toContain('72 hours');
  });

  it('keeps the tour page short enough for a composition that does not scroll', () => {
    // The tour is the one screen in the app with no scroll, capped at 1.2x
    // Dynamic Type, and this is the page that also carries the account
    // choice - so its body has the least room of the four and a long one
    // pushes that choice off a small screen.
    //
    // Measured against the pages it actually sits beside. It used to be
    // measured against the HOUSE-RULES section bodies, which run to several
    // hundred characters, so the assertion could not fail whatever anybody
    // wrote here.
    //
    // Twice the longest sibling, not once, and the factor is the honest part:
    // this page makes two promises where the others make one, so it is two
    // sentences rather than one or two short ones. At the time of writing
    // that is 110 characters against a bound of 116. A third sentence fails
    // it, which is exactly the edit worth catching.
    const siblings = tourSiblingBodies();
    expect(siblings).toHaveLength(3);
    const longest = Math.max(...siblings.map((body) => body.length));
    expect(SAFETY_PROMISE_BODY.length).toBeLessThanOrEqual(longest * 2);
    // And the title is one line of `title` type beside titles of 20 to 25.
    expect(SAFETY_PROMISE_TITLE.length).toBeLessThanOrEqual(30);
  });
});

describe('the policy copy obeys the copy rules', () => {
  const lines = [
    PRIVACY_PROMISE,
    SAFETY_PROMISE_TITLE,
    SAFETY_PROMISE_BODY,
    SIGN_UP_GATE_NOTE,
    SOCIALS_HIDDEN_NOTE,
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
