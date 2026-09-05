import { SLOT_ORDER, chooseSlot, type SlotKind } from '@/features/pins/message-slot';

// One strip, one occupant. Three or four things used to compete for it on
// overlapping offsets, and the least important one (a marker-family hint)
// won it in every screenshot of the last run.

describe('chooseSlot', () => {
  it('renders exactly one thing for EVERY combination, and the order holds', () => {
    // All 2^11 combinations. For each, the winner must be the first flag in
    // SLOT_ORDER that is set — the array is the priority.
    for (let mask = 0; mask < 1 << SLOT_ORDER.length; mask++) {
      const flags: Partial<Record<SlotKind, boolean>> = {};
      for (let bit = 0; bit < SLOT_ORDER.length; bit++) {
        if (mask & (1 << bit)) {
          flags[SLOT_ORDER[bit]] = true;
        }
      }
      const expected = SLOT_ORDER.find((kind) => flags[kind]) ?? null;
      expect(chooseSlot(flags)).toBe(expected);
    }
  });

  it('says nothing on a clear strip', () => {
    expect(chooseSlot({})).toBeNull();
  });

  it('lets a failure outrank every hint', () => {
    expect(chooseSlot({ 'places-legend': true, 'heat-legend': true, 'pins-error': true })).toBe(
      'pins-error'
    );
  });

  it('explains the empty city before teaching marker families', () => {
    expect(chooseSlot({ 'empty-city': true, 'places-legend': true })).toBe('empty-city');
  });

  it('labels the heat fallback ahead of the dismissible chips', () => {
    expect(chooseSlot({ 'heat-fallback': true, 'heat-legend': true, 'places-legend': true })).toBe(
      'heat-fallback'
    );
  });

  it('gives the two arrival moments the strip ahead of the legends', () => {
    expect(chooseSlot({ 'first-session': true, 'heat-legend': true })).toBe('first-session');
    expect(chooseSlot({ 'first-pin': true, 'places-legend': true })).toBe('first-pin');
  });
});
