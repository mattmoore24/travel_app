import { effectiveSelection, toggleTrip } from '@/features/matching/trip-selection';

const ALL = ['a', 'b', 'c'];

describe('toggleTrip: one tap at a time, and every tap means something', () => {
  it('from every trip, a tap narrows to that one trip', () => {
    expect(toggleTrip(null, 'b', ALL)).toEqual(['b']);
  });

  it('a second trip joins the first', () => {
    expect(toggleTrip(['b'], 'a', ALL)).toEqual(['b', 'a']);
  });

  it('untapping one of two leaves the other', () => {
    expect(toggleTrip(['b', 'a'], 'b', ALL)).toEqual(['a']);
  });

  it('untapping the only one left is every trip, never nothing', () => {
    expect(toggleTrip(['a'], 'a', ALL)).toBeNull();
  });

  it('picking the last missing trip by hand is every trip, so All lights', () => {
    expect(toggleTrip(['a', 'b'], 'c', ALL)).toBeNull();
  });
});

describe('a tap acts on what the chips show', () => {
  it('a stored set that covers every remaining trip narrows to the tapped city', () => {
    // Four trips picked by hand, one ended: the chips say All trips, so a
    // tap on a city must mean "just this one", not "drop this one".
    const stored = ['a', 'b', 'c', 'd'];
    const remaining = ['a', 'b', 'c'];
    expect(toggleTrip(effectiveSelection(stored, remaining), 'a', remaining)).toEqual(['a']);
  });
});

describe('effectiveSelection: what the queue is asked for', () => {
  it('every trip stays every trip', () => {
    expect(effectiveSelection(null, ALL)).toBeNull();
  });

  it('a trip that ended or was deleted drops out of the choice', () => {
    expect(effectiveSelection(['a', 'gone'], ALL)).toEqual(['a']);
  });

  it('a choice with nothing left in it is every trip', () => {
    expect(effectiveSelection(['gone'], ALL)).toBeNull();
  });

  it('a trip added while narrowed does not widen the choice', () => {
    // The new chip is visible next to the lit ones; widening would undo a
    // choice the person made.
    expect(effectiveSelection(['a'], ['a', 'b', 'new'])).toEqual(['a']);
  });

  it('a hand-picked set that covers every trip is every trip', () => {
    expect(effectiveSelection(['c', 'a', 'b'], ALL)).toBeNull();
  });
});
