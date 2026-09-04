import { queueScope } from '@/features/matching/queue-scope';

describe('one phrase for what the queue is for', () => {
  it('names one city', () => {
    expect(queueScope(['Lisbon'], 1, true)).toEqual({ noun: 'Lisbon', where: 'in Lisbon' });
    expect(queueScope(['Lisbon'], 2, false)).toEqual({ noun: 'Lisbon', where: 'in Lisbon' });
  });

  it('names two cities when two trips are in view', () => {
    expect(queueScope(['Lisbon', 'Porto'], 2, true)).toEqual({
      noun: 'Lisbon and Porto',
      where: 'in Lisbon and Porto',
    });
  });

  it('counts the trips once there are too many cities to say', () => {
    expect(queueScope(['Lisbon', 'Porto', 'Faro'], 3, true)).toEqual({
      noun: 'these 3 trips',
      where: 'across these 3 trips',
    });
  });

  it('says all your trips when nothing is narrowed', () => {
    expect(queueScope(['Lisbon', 'Porto', 'Faro'], 3, false)).toEqual({
      noun: 'all your trips',
      where: 'across all your trips',
    });
  });

  it('never claims presence', () => {
    for (const scope of [
      queueScope(['Lisbon'], 1, true),
      queueScope(['Lisbon', 'Porto'], 2, true),
      queueScope(['a', 'b', 'c'], 3, true),
      queueScope(['a', 'b', 'c'], 3, false),
    ]) {
      expect(`${scope.noun} ${scope.where}`).not.toMatch(
        /here now|near you|nearby|swipe|deck|match/i
      );
    }
  });
});
