import {
  RAIL_RESERVE,
  dockFootingOf,
  messageSlotOf,
  planListHeights,
} from '@/features/pins/bottom-stack';

// The map's bottom furniture used to be three floating slabs with strips of
// bare map between them. It is one card now, and these are the numbers that
// hold it together — executed, not scanned out of a 3,700-line screen.

const DOCK = { dockBottom: 92, dockHeight: 52, gap: 8 };

describe('the plate the dock stands on', () => {
  it('is the tab bar clearance, the measured button, and the step', () => {
    expect(dockFootingOf({ ...DOCK, dockShown: true })).toBe(152);
  });

  it('is the bare clearance for an owner with no button', () => {
    // A business whose listing is not live yet gets no dock at all, and its
    // card stands straight on the tab bar.
    expect(dockFootingOf({ ...DOCK, dockShown: false })).toBe(92);
  });

  it('grows with the button, never with the constant', () => {
    // The AX sizes: the label scales, onLayout reports it, and the card has
    // to sit on the real height or it covers the button's top edge.
    expect(dockFootingOf({ ...DOCK, dockHeight: 78, dockShown: true })).toBe(178);
  });
});

describe('the message strip', () => {
  it('clears the card by one gap, on the MEASURED peek', () => {
    expect(messageSlotOf({ footing: 152, peekHeight: 56, planListShown: true, gap: 8 })).toBe(216);
  });

  it('stays clear of a peek that Dynamic Type has grown', () => {
    // Composed from the constant instead, the chip sat BEHIND the card's own
    // top edge at the accessibility sizes.
    const grown = messageSlotOf({ footing: 228, peekHeight: 90, planListShown: true, gap: 8 });
    expect(grown).toBeGreaterThan(228 + 90);
  });

  it('falls back to the plate when there is no list', () => {
    expect(messageSlotOf({ footing: 152, peekHeight: 56, planListShown: false, gap: 8 })).toBe(152);
  });
});

// The invariant the whole change rests on: dropping the sheet to the screen
// edge moves no detent's top edge. The expressions being replaced are kept
// here as the oracle.
const oldFull = (anchor: number, peek: number, height: number) =>
  anchor + Math.max(peek, height - anchor - RAIL_RESERVE);
const oldHalf = (anchor: number, peek: number, height: number) => {
  const usable = Math.max(peek, height - anchor - RAIL_RESERVE);
  return anchor + Math.max(peek, Math.round(usable * 0.55));
};

describe('the detents', () => {
  it('land where the split layout put them, on every device and text size', () => {
    for (const windowHeight of [667, 852, 932, 1024]) {
      for (const footing of [92, 152, 228, 300]) {
        for (const peekHeight of [56, 76, 90, 140]) {
          const heights = planListHeights({ footing, peekHeight, windowHeight });
          expect(heights.full).toBe(oldFull(footing, peekHeight, windowHeight));
          expect(heights.half).toBe(oldHalf(footing, peekHeight, windowHeight));
          // The peek is flush with the plate by construction: the header is
          // peekHeight tall and its lower edge IS the plate's top edge.
          expect(heights.peek).toBe(footing + peekHeight);
        }
      }
    }
  });

  it('never inverts, whatever the plate costs', () => {
    // The pan snaps to whichever detent is nearest where the finger left it,
    // so a ladder out of order could land the sheet below its own peek.
    for (const windowHeight of [568, 667, 852, 1024]) {
      for (const footing of [92, 152, 300, 480]) {
        const heights = planListHeights({ footing, peekHeight: 56, windowHeight });
        expect(heights.half).toBeGreaterThanOrEqual(heights.peek);
        expect(heights.full).toBeGreaterThanOrEqual(heights.half);
      }
    }
  });

  it('never leaves the list frame hanging below the screen edge', () => {
    // `marginBottom: full - target` is what clips the frame to the screen;
    // negative would push it back off the bottom and hide the last rows.
    const heights = planListHeights({ footing: 152, peekHeight: 56, windowHeight: 852 });
    for (const target of [heights.peek, heights.half, heights.full]) {
      expect(heights.full - target).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps the city rail clear at the full detent', () => {
    const heights = planListHeights({ footing: 152, peekHeight: 56, windowHeight: 852 });
    expect(852 - heights.full).toBe(RAIL_RESERVE);
  });
});
