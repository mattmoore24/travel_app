import { tabDockBottomOf } from '@/hooks/use-tab-bar-inset';

// The founder photographed the Map tab and said the Drop-a-pin button and the
// plan card were "taking up so much room on the bottom". They were: the dock
// stood 141.3pt up on a phone whose tab bar ends at 83.3, because the hook
// added BottomTabInset to an inset that already contained the bar.
//
// Measured off that screenshot at 3x, iPhone 15/16 Pro: the capsule's top edge
// and the tab child's own bottom inset are the same 83.3pt, while the WINDOW's
// bottom inset (the home indicator alone) is 34.
const TAB = { insetBottom: 83.3, windowInsetBottom: 34, tabBarInset: 50, barInInset: true };

describe('where a dock sits above the tab bar', () => {
  it('stands one gap above the bar that is already inside the inset', () => {
    // 141.3 before this, which is the 50pt of dead map the founder saw.
    expect(tabDockBottomOf(TAB)).toBeCloseTo(91.3, 1);
  });

  it('adds the bar for a tree mounted outside the tab host', () => {
    // ConnectedNotice is a sibling of the tabs, so its nearest provider is the
    // root one and its inset is the home indicator alone. It must not move.
    expect(tabDockBottomOf({ ...TAB, insetBottom: 34 })).toBe(92);
  });

  it('adds the bar on the frame before a tab provider has laid out', () => {
    // A provider seeds from its parent, so the first frame reports the
    // window's inset. This is the frame that must never put the app's primary
    // action under the bar, which is the bug the constant was added for.
    expect(tabDockBottomOf({ ...TAB, insetBottom: 34 })).toBeGreaterThan(83.3);
  });

  it('tracks a bar the accessibility sizes grew, past the clamped estimate', () => {
    // The fontScale estimate is capped at 2x (100) and would go SHORT of a
    // 120pt bar. A measurement does not have that ceiling.
    expect(tabDockBottomOf({ ...TAB, insetBottom: 120, tabBarInset: 100 })).toBe(128);
  });

  it('keeps the sum off iOS, where the bar is the app own chrome', () => {
    expect(tabDockBottomOf({ ...TAB, barInInset: false, tabBarInset: 80 })).toBeCloseTo(171.3, 1);
  });

  it('clears the bar on a phone with no home indicator', () => {
    // An inset that is only barely more than the window's is still the bar.
    expect(
      tabDockBottomOf({ insetBottom: 49, windowInsetBottom: 0, tabBarInset: 50, barInInset: true })
    ).toBe(57);
    // ...and one that reports nothing at all falls back rather than sitting on
    // the bar.
    expect(
      tabDockBottomOf({ insetBottom: 0, windowInsetBottom: 0, tabBarInset: 50, barInInset: true })
    ).toBe(58);
  });

  it('never places a dock lower than the formula it replaces', () => {
    // The safety property of the whole change: when the inset does not exceed
    // the window's, this is byte-for-byte the old sum, so a wrong read of a
    // device degrades to today's behaviour and never to a buried button.
    for (const windowInsetBottom of [0, 20, 34, 48]) {
      for (const tabBarInset of [50, 75, 100]) {
        for (const insetBottom of [0, 34, 49, 83.3, 120]) {
          const now = tabDockBottomOf({
            insetBottom,
            windowInsetBottom,
            tabBarInset,
            barInInset: true,
          });
          const measured = insetBottom - windowInsetBottom > 1;
          // Either it is the old sum, or it is a real measurement of the bar.
          expect(now).toBe(measured ? insetBottom + 8 : tabBarInset + insetBottom + 8);
          if (measured) {
            // A measured dock still clears the bar it measured.
            expect(now).toBeGreaterThan(insetBottom);
          }
        }
      }
    }
  });
});
