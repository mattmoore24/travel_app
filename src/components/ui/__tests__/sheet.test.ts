import fs from 'node:fs';
import path from 'node:path';

import { SHEET_EXIT_MS, SHEET_SETTLE_MS } from '@/components/ui/sheet';

/**
 * The sheet's entrance must never go back to a Reanimated layout preset.
 *
 * `SlideInDown` and its siblings animate the view's real layout — `originY`,
 * not `translateY` — and for as long as one is running Reanimated re-applies
 * the frame it snapshotted when the animation began, width and height
 * included (LayoutAnimationsProxy_Legacy::addOngoingAnimations). A sheet whose
 * content arrives after the tap that opened it therefore freezes at the size
 * it had at the moment of the tap.
 *
 * That is not theoretical: the place card opened about a third of the way and
 * only came up whole on a second tap, once the query cache made the card
 * complete before the animation started. Every sheet in this app can hold
 * something that loads, so the rule is the primitive's, not the caller's.
 *
 * Comments are stripped before scanning because this file's own prose, and the
 * sheet's, both have to be able to name the thing they are banning.
 */
const source = (file: string): string =>
  fs
    .readFileSync(path.join(__dirname, '..', file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('Sheet presentation', () => {
  const code = source('sheet.tsx');

  it('slides in on a transform, not a layout animation', () => {
    expect(code).toContain('translateY: drag.value + enter.value * height');
    expect(code).toMatch(/enter\.value = withSpring\(0, Springs\.sheet\)/);
  });

  it('never presents with a layout-animation preset', () => {
    for (const preset of ['SlideInDown', 'SlideInUp', 'ZoomIn', 'SlideInLeft', 'SlideInRight']) {
      expect(code).not.toContain(preset);
    }
  });

  it('leaves the sheet body itself with no entering prop', () => {
    // The scrim keeps one: it is `StyleSheet.absoluteFill`, so its frame is
    // its parent's and cannot be stale. Exactly one is the whole allowance.
    expect(code.match(/entering=/g) ?? []).toHaveLength(1);
    expect(code).toContain('entering={FadeIn.duration(Motion.quick)}');
  });

  it('waits longer than the exit animation before anything follows it', () => {
    expect(code).toContain('SlideOutDown.duration(200)');
    expect(SHEET_EXIT_MS).toBeGreaterThan(200);
    expect(SHEET_SETTLE_MS).toBeGreaterThan(SHEET_EXIT_MS);
  });

  it('routes every dismissal gesture through onCloseRequest when one is set', () => {
    // The discard guard's seam: with onCloseRequest set, the scrim tap, the
    // pull-down, the grabber's accessibility tap and Android's back all call
    // it INSTEAD of onClose, so a guard can ask before state is thrown
    // away. With it absent the alias IS onClose and nothing changes for the
    // other callers.
    expect(code).toContain('const requestClose = onCloseRequest ?? onClose;');
    // The pull gesture's dismissal branch goes through the alias — and only
    // through it: a stray runOnJS(onClose) would be a pull that skips the
    // guard.
    expect(code).toContain('runOnJS(requestClose)()');
    expect(code).not.toContain('runOnJS(onClose)');
    // The scrim and the grabber's accessibility tap too.
    expect(code).toContain('onPress={requestClose}');
    expect(code).toContain('onAccessibilityTap={requestClose}');
    expect(code).toContain('onRequestClose={requestClose}');
    // A refused dismissal must spring the sheet home rather than leave it
    // parked halfway off screen: the drag reset stays unconditional, BEFORE
    // the dismissal branch decides anything.
    const reset = code.indexOf('drag.value = withSpring(0, Springs.release)');
    const branch = code.indexOf('runOnJS(requestClose)()');
    expect(reset).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(reset);
  });

  it('hands the drag to the whole card, not to the grabber strip', () => {
    // The bug this replaces: the GestureDetector wrapped the 24pt grabber, so
    // pulling a card down by its own title did nothing — on three surfaces
    // over the live map that a person reaches for by the header. A refactor
    // that puts the detector back around the grabber has to fail here.
    const detector = code.indexOf('<GestureDetector gesture={pull}>');
    expect(detector).toBeGreaterThan(-1);
    expect(code.match(/<GestureDetector/g)).toHaveLength(1);

    // The first element it opens is the card itself. Nothing — least of all
    // the grabber's View — may come between them.
    const card = code.indexOf('<Animated.View', detector);
    expect(card).toBeGreaterThan(detector);
    expect(code.slice(detector, card)).not.toContain('<View');

    // And it closes AFTER the card, so the sheet's children (the grabber, the
    // scroller, a caller's list) are all inside the drag target rather than
    // beside it.
    const cardEnd = code.indexOf('</Animated.View>', card);
    const detectorEnd = code.indexOf('</GestureDetector>', card);
    expect(cardEnd).toBeGreaterThan(card);
    expect(detectorEnd).toBeGreaterThan(cardEnd);

    // The grabber is inside the card and keeps its own VoiceOver button: a
    // pull is not something VoiceOver can perform, so "Dismiss" on the strip
    // is the only keyboard-free way out of a sheet.
    const grabber = code.indexOf('testID="sheet-grabber"');
    expect(grabber).toBeGreaterThan(card);
    expect(grabber).toBeLessThan(cardEnd);
    expect(code).toContain('accessibilityHint="Or pull down"');
  });

  it('needs 10pt of DOWNWARD travel before the pan takes the touch', () => {
    // Three jobs, one line. It keeps the pan off a tap now that every button
    // on the card sits under the detector; it enforces the down-only decision
    // at the gesture (a positive offset leaves the upward end unbounded, so an
    // upward drag can never activate) on top of the clamp below; and it is
    // what lets an inner scroller win, because a UIScrollView's own pan
    // recognises well inside 10pt and RNGH refuses simultaneous recognition
    // with a recogniser it has no declared relation to.
    expect(code).toContain('.activeOffsetY(10)');
    expect(code).toContain('drag.value = Math.max(0, event.translationY)');
  });

  it('never declares a relation that would stop an inner list scrolling', () => {
    // `blocksExternalGesture(scroller)` reverses the relation: the scroller
    // would wait for this pan to fail, and the venue stack inside place-sheet
    // becomes unscrollable — worse than the bug this package fixes.
    // `simultaneousWithExternalGesture` is the other half of the trap: the
    // list would scroll and the sheet drag down on the same finger.
    expect(code).not.toContain('blocksExternalGesture');
    expect(code).not.toContain('simultaneousWithExternalGesture');
  });

  it('keeps its own gesture root, because a Modal is hosted outside the navigator’s', () => {
    // A React Native Modal gets its own native window, which sits outside the
    // gesture root the navigator establishes — without this the pull is dead
    // on every presented sheet, and it is now the card's whole surface that
    // would be dead rather than 24pt of it.
    const modal = code.indexOf('<Modal');
    const root = code.indexOf('<GestureHandlerRootView', modal);
    const modalEnd = code.indexOf('</Modal>', modal);
    expect(modal).toBeGreaterThan(-1);
    expect(root).toBeGreaterThan(modal);
    expect(root).toBeLessThan(modalEnd);
    expect(code).toMatch(/<GestureHandlerRootView[^>]*>\{body\}<\/GestureHandlerRootView>/);
  });

  it('mounts its scroller only when a caller opts in with `scrolls`', () => {
    // Opt-in is what keeps the blast radius small: pin-form-sheet and
    // place-sheet own their scrollers already, and a second one around them
    // would be the stacked-scroller freeze.
    expect(code).toContain('scrolls = false');
    const branch = code.indexOf('{scrolls ? (');
    const scroller = code.indexOf('<ScrollView');
    expect(branch).toBeGreaterThan(-1);
    expect(scroller).toBeGreaterThan(branch);
    // One scroller, inside that branch only.
    expect(code.match(/<ScrollView/g)).toHaveLength(1);
    // The pin-form recipe, kept: a tap on the next field is not eaten while
    // one has focus, dragging dismisses the keyboard, and the scroller
    // shrinks rather than overflowing the capped sheet.
    const body = code.slice(branch, code.indexOf('</ScrollView>'));
    expect(body).toContain('keyboardShouldPersistTaps="always"');
    expect(body).toContain('keyboardDismissMode="interactive"');
    expect(code).toMatch(/scroll: \{[^}]*flexShrink: 1/);
  });
});
