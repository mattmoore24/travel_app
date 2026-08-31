import fs from 'node:fs';
import path from 'node:path';

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
 * The tab-bar half of the clearance is a HOOK now (use-tab-bar-inset): the
 * native bar grows with Dynamic Type, and the 50pt constant it replaces is
 * only the floor. The one-formula rule survives the move — the dock offset
 * is still computed in exactly one place.
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
const hook = strip(path.join(__dirname, '..', '..', 'hooks', 'use-tab-bar-inset.ts'));

describe('the action bar and its ground share one formula', () => {
  it('the bar height is measured, seeded from the one formula', () => {
    expect(bar).toContain('return Space.sm + ACTION_BUTTON + bottomInset;');
    // Measured by onLayout, formula only as the first-frame seed: at the
    // accessibility sizes the buttons outgrow any formula, and a derived
    // plate put them back on the translucent ramp twice.
    expect(bar).toContain('measured ?? dockedActionBarHeight(bottomInset)');
    expect(bar).toContain('onLayout');
    expect(screen).toContain('useState(() => dockedActionBarHeight(dockBottom))');
    // The halved inset was the drift; it must not come back anywhere here.
    for (const source of [screen, bar, hook]) {
      expect(source).not.toContain('insets.bottom / 2');
      expect(source).not.toContain('bottomInset / 2');
    }
  });

  it('the dock offset takes the whole inset, floored at the constant', () => {
    // dockBottom = tabBarInset + insets.bottom + Space.sm, where tabBarInset
    // never drops below BottomTabInset and scales with fontScale (clamped).
    expect(hook).toContain('return tabBarInset + insets.bottom + Space.sm;');
    expect(hook).toContain('Math.min(Math.max(fontScale, 1), MAX_TAB_BAR_SCALE)');
    expect(hook).toContain('Math.round(BottomTabInset * scale)');
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

  it("travelers' scroll clearance rides the measured height, not a magic number", () => {
    expect(screen).toContain('paddingBottom: barHeight + Space.xl');
    expect(screen).not.toContain('ACTION_BAR_CLEARANCE');
  });

  it('the bar pads with the inset it is handed, and travelers hands it the dock', () => {
    expect(bar).toContain('paddingBottom: bottomInset');
    expect(screen).toContain('bottomInset={dockBottom}');
  });

  it('Next is a labelled pill on a visible border, tracking its neighbour', () => {
    expect(screen).toContain('borderColor: theme.border');
    expect(screen).not.toContain('borderColor: theme.hairline');
    expect(screen).not.toContain('StyleSheet.hairlineWidth');
    // The visible word, and the unique spoken label.
    expect(screen).toMatch(/>\s*Next\s*<\/ThemedText>/);
    expect(screen).toContain('accessibilityLabel="Next traveler"');
    // minHeight and stretch, never a fixed height: at large text the pill
    // grows with the Say hi button instead of shrinking away from it.
    expect(screen).toContain('minHeight: ACTION_BUTTON');
    expect(screen).not.toContain('height: ACTION_BUTTON');
  });

  it('the primary action has one label and one reason ever to be off', () => {
    // Three of this button's four states were unreachable. The queue filter
    // drops everybody already written to and everybody already in a chat
    // BEFORE a card is chosen, so `sent` and `chatId` were always undefined
    // for the rendered traveler: the label was always "Say hi", `disabled`
    // was always false, and the file described behaviour it could not
    // produce. The cap is the one real off state left.
    expect(screen).not.toContain('canOpen');
    expect(screen).not.toContain("'Open chat'");
    expect(screen).not.toContain("'Message sent'");
    expect(screen).toContain(
      "primaryLabel={helloCapped ? 'No first messages left today' : 'Say hi'}"
    );
    expect(screen).toContain('disabled={helloCapped}');
  });

  it('carries safety on the row where a stranger is decided on', () => {
    // Travelers is the screen somebody spends the most time on with one
    // stranger at a time, and it had no report and no block at all. The card
    // has no header, so the bottom row is the honest anchor.
    expect(screen).toContain('accessibilityLabel={`More about ${name}`}');
    expect(screen).toContain('openTravelerMenu({');
    // Icon only and shrink-proof: at the accessibility sizes this row is Say
    // hi, Next and this, and the primary is the one that must keep its words.
    expect(screen).toContain('width: HitTarget,');
  });

  it('a stacked screen does not carry the tab dock', () => {
    // The pin-reached profile sits under a nav header with no tab bar;
    // the tab-bar inset there floats the bar 49pt too high.
    const profile = strip(path.join(__dirname, '..', 'profile', '[userId].tsx'));
    expect(profile).toContain('DockedActionBar');
    expect(profile).not.toContain('BottomTabInset');
    expect(profile).not.toContain('useTabDockBottom');
  });
});
