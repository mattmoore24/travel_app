import fs from 'node:fs';
import path from 'node:path';

import { Space, tabDockBottom } from '@/constants/theme';

/**
 * The Say hi bar's opaque plate can never drift from the bar it is covering.
 *
 * The bar's height, the plate's height, the ramp's anchor and the scroll
 * clearance all derive from actionBarHeight, and actionBarHeight derives
 * from tabDockBottom — the one formula every docked bar uses. The 17pt bug
 * this pins down: travelers halved the safe-area inset while the Map's
 * "Drop a pin" pill took it whole, so the same chrome sat at two heights on
 * one phone.
 *
 * The identity is asserted against the source rather than the imported
 * function so this test does not have to evaluate a screen module whose
 * imports reach native code; the expression IS the guarantee.
 */

const screen = fs
  .readFileSync(path.join(__dirname, '..', '(tabs)', 'travelers.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the action bar and its ground share one formula', () => {
  it('actionBarHeight is defined on tabDockBottom, full inset', () => {
    expect(screen).toContain('return Space.sm + ACTION_BUTTON + tabDockBottom(bottomInset);');
    // The halved inset was the drift; it must not come back anywhere here.
    expect(screen).not.toContain('insets.bottom / 2');
    expect(screen).not.toContain('bottomInset / 2');
  });

  it('tabDockBottom takes the whole inset', () => {
    // actionBarHeight(34) === tabDockBottom(34) + Space.sm + ACTION_BUTTON
    // by construction (the assertion above); this checks the base formula.
    expect(tabDockBottom(34)).toBe(50 + 34 + Space.sm);
  });

  it('the plate is solid and exactly bar-height, with the ramp above it', () => {
    expect(screen).toContain(
      'height: actionBarHeight(insets.bottom), backgroundColor: theme.background'
    );
    expect(screen).toContain('height: ACTION_BAR_RAMP, bottom: actionBarHeight(insets.bottom)');
    // The old single gradient put the buttons on a half-transparent wash.
    expect(screen).not.toContain('locations={[0, 0.55]}');
  });

  it('the scroll clearance is derived, not a magic number', () => {
    expect(screen).toContain('paddingBottom: actionBarHeight(insets.bottom) + Space.xl');
    expect(screen).not.toContain('ACTION_BAR_CLEARANCE');
  });

  it('the bar pads with the shared dock formula', () => {
    expect(screen).toContain('paddingBottom: tabDockBottom(insets.bottom)');
  });

  it('Next is a labelled pill on a visible border', () => {
    expect(screen).toContain('borderColor: theme.border');
    expect(screen).not.toContain('borderColor: theme.hairline');
    expect(screen).not.toContain('StyleSheet.hairlineWidth');
    // The visible word, and the unique spoken label.
    expect(screen).toMatch(/>\s*Next\s*<\/ThemedText>/);
    expect(screen).toContain('accessibilityLabel="Next traveler"');
  });
});
