import { remainingLine } from '@/features/matching/queue-copy';

/**
 * The scope line on the Travelers queue. It counts the QUEUE, never the
 * city, and it must read cleanly at every size a queue can be.
 */
describe('remainingLine', () => {
  it('counts the people behind this one', () => {
    expect(remainingLine(4, 'in Bangkok')).toBe('4 more on your dates in Bangkok');
  });

  it('spells out a single remaining person', () => {
    expect(remainingLine(1, 'in Bangkok')).toBe('One more on your dates in Bangkok');
  });

  it('says so when this is the last one', () => {
    expect(remainingLine(0, 'in Bangkok')).toBe('Last one for now');
  });

  it('takes the scope as a phrase, so several trips read as one thing', () => {
    // The city used to be borrowed from whoever was on screen, so a queue
    // across Lisbon and Bangkok said "in Lisbon" on one card and "in
    // Bangkok" on the next. The phrase comes from queue-scope now.
    expect(remainingLine(4, 'across all your trips')).toBe(
      '4 more on your dates across all your trips'
    );
    expect(remainingLine(1, 'in Lisbon and Porto')).toBe(
      'One more on your dates in Lisbon and Porto'
    );
    expect(remainingLine(4, null)).toBe('4 more on your dates');
  });

  it('makes no presence claims and no dating vocabulary', () => {
    for (const n of [0, 1, 5]) {
      const line = remainingLine(n, 'Bangkok');
      expect(line).not.toMatch(/here now|near you|nearby/i);
      expect(line).not.toMatch(/swipe|deck|match/i);
    }
  });
});
