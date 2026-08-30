import { remainingLine } from '@/features/matching/queue-copy';

/**
 * The scope line on the Travelers queue. It counts the QUEUE, never the
 * city, and it must read cleanly at every size a queue can be.
 */
describe('remainingLine', () => {
  it('counts the people behind this one', () => {
    expect(remainingLine(4, 'Bangkok')).toBe('4 more on your dates in Bangkok');
  });

  it('spells out a single remaining person', () => {
    expect(remainingLine(1, 'Bangkok')).toBe('One more on your dates in Bangkok');
  });

  it('says so when this is the last one', () => {
    expect(remainingLine(0, 'Bangkok')).toBe('Last one for now');
  });

  it('makes no presence claims and no dating vocabulary', () => {
    for (const n of [0, 1, 5]) {
      const line = remainingLine(n, 'Bangkok');
      expect(line).not.toMatch(/here now|near you|nearby/i);
      expect(line).not.toMatch(/swipe|deck|match/i);
    }
  });
});
