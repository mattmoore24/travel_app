import fs from 'node:fs';
import path from 'node:path';

import {
  lastCallBody,
  planIsSoonBody,
  tripStartsTomorrowBody,
  tripStartsTomorrowTitle,
} from '@/features/notifications/copy';

/**
 * The three clocks are the first pushes this app sends that nobody typed, and
 * they are composed in SQL, on a schedule, with no app anywhere near them.
 * That is exactly the shape of copy that ships unreviewed.
 *
 * So: the sentences are written in TypeScript as well, held to the same
 * vocabulary rules as any other user-facing string, and asserted to still be
 * what the migration says. Editing one without the other fails here.
 */

const MIGRATION = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'supabase',
    'migrations',
    '20260902040000_three_clocks_inside_a_trip.sql'
  ),
  'utf8'
);

const PRIMER = fs.readFileSync(path.join(__dirname, '..', 'push-primer.tsx'), 'utf8');

const BANNED = /\b(swipe|deck|match|unmatch(?:ed)?|request|hello|here now|near you|nearby)\b/i;

const everything = [
  tripStartsTomorrowTitle('Bangkok'),
  tripStartsTomorrowBody(14),
  tripStartsTomorrowBody(null),
  planIsSoonBody(1),
  planIsSoonBody(3),
  lastCallBody('23:00', 1),
  lastCallBody('23:00', 3),
];

describe('what the three clocks say', () => {
  it('carries none of the banned vocabulary', () => {
    expect(everything.filter((line) => BANNED.test(line))).toEqual([]);
  });

  it('carries no em dash and no other AI tell', () => {
    expect(everything.filter((line) => line.includes('—') || line.includes('–'))).toEqual([]);
  });

  it('never makes a presence claim, which is the one thing this app cannot say', () => {
    // Hard rule 2: no live location, ever. "there on your dates" is a city
    // and a date range, which is exactly what a trip is; "near you" would be
    // a claim about where somebody is standing.
    expect(tripStartsTomorrowBody(14)).toBe('14 travelers are there on your dates.');
  });

  it('says nothing about how many people are around when the count is gated', () => {
    // Hard rule 6, as a sentence. Below the city's heat_k the body carries no
    // number at all - not a smaller one, not "a few".
    expect(tripStartsTomorrowBody(null)).not.toMatch(/[0-9]/);
    expect(tripStartsTomorrowBody(null)).toBe(
      'Your trip starts tomorrow. See who else has the same dates.'
    );
  });

  it('does not invent an hour a pin never carried', () => {
    // A pin holds a DATE. "Sky Bar at 8" would be made up.
    expect(planIsSoonBody(3)).toBe('Happening today. 3 people are in.');
    expect(planIsSoonBody(1)).toBe('Happening today. 1 person is in.');
  });

  it('reads the closing time off the pin rather than rounding it to a word', () => {
    expect(lastCallBody('23:00', 3)).toBe('Closing at 23:00. 3 people are in.');
  });

  it('still says exactly what the migration says', () => {
    expect(MIGRATION).toContain("' travelers are there on your dates.'");
    expect(MIGRATION).toContain("'Your trip starts tomorrow. See who else has the same dates.'");
    expect(MIGRATION).toContain("'Happening today. '");
    expect(MIGRATION).toContain("' person is in.'");
    expect(MIGRATION).toContain("' people are in.'");
    expect(MIGRATION).toContain("'Closing at '");
  });
});

/**
 * The promise the clocks live under.
 *
 * The primer's sentence is why people say yes. It named three kinds of
 * notification and promised nothing else, ever; the clocks are a fourth. The
 * honest half of shipping them is that the sentence changes first, in the
 * same bundle, and keeps its absolute shape rather than becoming a hedge.
 */
describe('the promise the primer makes', () => {
  it('names the fourth kind in every reason it can ask under', () => {
    const bodies = [...PRIMER.matchAll(/body: '([^']*(?:\\'[^']*)*)'/g)].map((m) => m[1]);
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body).toMatch(/your own trips and plans/);
      expect(body).toContain('Nothing else, ever.');
    }
  });

  it('has not softened the promise into a hedge', () => {
    for (const weasel of ['occasionally', 'from time to time', 'and more', 'other updates']) {
      expect(PRIMER.toLowerCase()).not.toContain(weasel);
    }
  });
});
