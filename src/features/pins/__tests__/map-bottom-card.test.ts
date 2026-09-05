import fs from 'node:fs';
import path from 'node:path';

// The founder's word for the old bottom of this screen was "looks bad", and
// what was bad about it was structural: the plan list's sheet stopped 152pt
// short of the screen, so its lower edge was a hard cut with the Drop-a-pin
// button floating in the gap below it. Three slabs where there is one thing.
// Sibling order IS z-order and neither of those facts can be expressed in a
// render test, so they are asserted against the file's own shape.

const read = (file: string) =>
  fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');

const map = read('map-screen.tsx');
const list = read('plan-list.tsx');

describe('the map ends in one card', () => {
  it('composes the message strip from measured heights, never from the constant', () => {
    expect(map).toContain('peekHeight: planPeekHeight,');
    expect(map).toContain('onPeekHeight={setPlanPeekHeight}');
    // The constant survives as the seed and as the floor, never as the
    // anchor: the strip renders at its Dynamic Type height, and a slot
    // composed from 56 put the chip behind the card at the AX sizes.
    expect(map).toContain('useState(PLAN_LIST_PEEK)');
    expect(map).not.toContain('PLAN_LIST_PEEK + Space.sm');
    expect(map).not.toContain('planListBottom');
  });

  it('paints the dock OVER the sheet, not under it', () => {
    // The sheet now covers the dock's rect at every detent. Declared before
    // it, the button would be invisible the moment the list opened.
    const sheet = map.indexOf('<PlanList');
    const plate = map.indexOf('styles.dockPlate, { height: dockFooting');
    const pill = map.indexOf('accessibilityLabel="Drop a pin"');
    const business = map.indexOf('&& businessDockShown && !selectedPin ? (');
    expect(sheet).toBeGreaterThan(-1);
    expect(sheet).toBeLessThan(plate);
    expect(plate).toBeLessThan(pill);
    // ...and the traveler dock stays ahead of the business dock, or 'Drop a
    // pin' falls inside the window business-map.test.ts slices forward from
    // the business gate, and a business is told it may drop pins.
    expect(pill).toBeLessThan(business);
  });

  it('gives the plate the list, not the button, as its condition', () => {
    // An owner whose listing is not live has no dock and still has a list.
    // With no plate its first rows would render sliced by the tab bar.
    expect(map).toContain('{planListShown ? (');
    expect(map).toMatch(/pointerEvents="none"\s*\n\s*style=\{\[styles\.dockPlate/);
  });

  it('leaves the place-mode bar on the tab bar, not on a card', () => {
    // PlanList is gated on browse, so there is no card while a pin is being
    // placed and the confirm bar must not fly up a shoulder that is not there.
    expect(map).toContain("{mode === 'place' ? (");
    expect(map).toContain('style={[styles.dock, { bottom: dockBottom }]}');
  });
});

describe('the sheet runs to the screen edge', () => {
  it('has no anchor left to float on', () => {
    expect(list).toMatch(/host: \{[\s\S]{0,700}bottom: 0,[\s\S]{0,120}\},/);
    expect(list).toContain("overflow: 'hidden'");
    expect(list).not.toContain('styles.host, { bottom }');
  });

  it('clips its own frame to the screen, so the last row is reachable', () => {
    // The sheet is a fixed heights.full box that slides, so under the full
    // detent its lower (full - target) points are off screen — and content
    // down there could not be scrolled into view at all.
    expect(list).toContain('{ marginBottom: heights.full - target }');
    expect(list).toContain('{ paddingBottom: footing + Space.lg }');
  });

  it('still slides on a transform, never a layout preset', () => {
    // The Slide family animates the view's real frame and re-applies the one
    // it snapshotted, which freezes a sheet whose content arrives late.
    expect(list).not.toMatch(/SlideIn|SlideOut|LinearTransition/);
    expect(list).toContain('transform: [{ translateY: -(sprung.value + drag.value) }]');
  });
});
