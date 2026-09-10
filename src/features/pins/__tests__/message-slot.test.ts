import { SLOT_ORDER, chooseSlot, type SlotKind } from '@/features/pins/message-slot';

// One strip, one occupant. Three or four things used to compete for it on
// overlapping offsets, and the least important one (a marker-family hint)
// won it in every screenshot of that run. The two hints have since left the
// strip entirely, for the map's own permanent key: what is left here is
// failures, absences and arrivals.

describe('chooseSlot', () => {
  it('renders exactly one thing for EVERY combination, and the order holds', () => {
    // Every combination — 2^9 now that the two teaching chips are gone, and
    // the loop reads SLOT_ORDER.length rather than a number, so it follows.
    // For each, the winner must be the first flag in SLOT_ORDER that is set.
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

  it('lets a failure outrank every absence', () => {
    expect(chooseSlot({ 'way-home': true, 'empty-city': true, 'pins-error': true })).toBe(
      'pins-error'
    );
  });

  it("explains the owner's missing chip before the empty city around it", () => {
    expect(chooseSlot({ 'empty-city': true, 'own-listing': true })).toBe('own-listing');
  });

  it('names the empty city before the empty viewport inside it', () => {
    expect(chooseSlot({ 'empty-city': true, 'viewport-empty': true })).toBe('empty-city');
  });

  it('gives the two arrival moments the strip ahead of the heat footnote', () => {
    expect(chooseSlot({ 'first-session': true, 'heat-fallback': true })).toBe('first-session');
    expect(chooseSlot({ 'first-pin': true, 'heat-fallback': true })).toBe('first-pin');
  });

  it('puts the heat footnote last, and it is now the lowest rank there is', () => {
    // It is the only persistent occupant — persistent for exactly as long as
    // its layer is drawn — so everything else must be able to take the strip
    // from it.
    for (const kind of SLOT_ORDER) {
      if (kind === 'heat-fallback') {
        continue;
      }
      expect(chooseSlot({ 'heat-fallback': true, [kind]: true })).toBe(kind);
    }
  });
});
