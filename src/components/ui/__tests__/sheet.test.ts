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
});
