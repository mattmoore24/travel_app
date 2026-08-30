import fs from 'node:fs';
import path from 'node:path';

import { Space, tabDockBottom } from '@/constants/theme';

/**
 * The docked action bar's opaque plate can never drift from the bar it is
 * covering.
 *
 * The bar's height, the plate's height, the ramp's anchor and the scroll
 * clearance all derive from one formula. The bar itself now lives in
 * components/ui/docked-action-bar (Travelers and the pin-reached profile
 * dock the same chrome), so the plate/ramp geometry is asserted against the
 * component and the tab-specific derivation against the screen. The 17pt
 * bug this pins down: travelers halved the safe-area inset while the Map's
 * "Drop a pin" pill took it whole, so the same chrome sat at two heights on
 * one phone.
 *
 * The identity is asserted against the source rather than the imported
 * function so this test does not have to evaluate a screen module whose
 * imports reach native code; the expression IS the guarantee.
 */

const strip = (file: string) =>
  fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const screen = strip(path.join(__dirname, '..', '(tabs)', 'travelers.tsx'));
const bar = strip(path.join(__dirname, '..', '..', 'components', 'ui', 'docked-action-bar.tsx'));

describe('the action bar and its ground share one formula', () => {
  it('the bar height is one expression, and travelers derives from it on tabDockBottom', () => {
    expect(bar).toContain('return Space.sm + ACTION_BUTTON + bottomInset;');
    expect(screen).toContain('return dockedActionBarHeight(tabDockBottom(bottomInset));');
    // The halved inset was the drift; it must not come back anywhere here.
    for (const source of [screen, bar]) {
      expect(source).not.toContain('insets.bottom / 2');
      expect(source).not.toContain('bottomInset / 2');
    }
  });

  it('tabDockBottom takes the whole inset', () => {
    // actionBarHeight(34) === tabDockBottom(34) + Space.sm + ACTION_BUTTON
    // by construction (the assertion above); this checks the base formula.
    expect(tabDockBottom(34)).toBe(50 + 34 + Space.sm);
  });

  it('the plate is solid and exactly bar-height, with the ramp above it', () => {
    expect(bar).toContain('height: barHeight, backgroundColor: theme.background');
    expect(bar).toContain('height: ACTION_BAR_RAMP, bottom: barHeight');
    // The old single gradient put the buttons on a half-transparent wash.
    expect(bar).not.toContain('locations={[0, 0.55]}');
  });

  it('the plate and ramp are inert to touch, and the bar lets taps through', () => {
    // The hit-testing trap: an invisible full-screen layer that answers
    // hit-tests kills the page under it.
    expect(bar).toContain('pointerEvents="none"');
    expect(bar).toContain('pointerEvents="box-none"');
  });

  it("travelers' scroll clearance is derived, not a magic number", () => {
    expect(screen).toContain('paddingBottom: actionBarHeight(insets.bottom) + Space.xl');
    expect(screen).not.toContain('ACTION_BAR_CLEARANCE');
  });

  it('the bar pads with the inset it is handed, and travelers hands it the dock', () => {
    expect(bar).toContain('paddingBottom: bottomInset');
    expect(screen).toContain('bottomInset={tabDockBottom(insets.bottom)}');
  });

  it('Next is a labelled pill on a visible border', () => {
    expect(screen).toContain('borderColor: theme.border');
    expect(screen).not.toContain('borderColor: theme.hairline');
    expect(screen).not.toContain('StyleSheet.hairlineWidth');
    // The visible word, and the unique spoken label.
    expect(screen).toMatch(/>\s*Next\s*<\/ThemedText>/);
    expect(screen).toContain('accessibilityLabel="Next traveler"');
  });

  it('a stacked screen does not carry the tab dock', () => {
    // The pin-reached profile sits under a nav header with no tab bar;
    // BottomTabInset there floats the bar 49pt too high.
    const profile = strip(path.join(__dirname, '..', 'profile', '[userId].tsx'));
    expect(profile).toContain('DockedActionBar');
    expect(profile).not.toContain('BottomTabInset');
    expect(profile).not.toContain('tabDockBottom');
  });
});
