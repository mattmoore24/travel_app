import { between, source } from '@/lib/__tests__/source';

/**
 * The composer's inset lives in exactly one place.
 *
 * E2E run 142 (zz-ax5-07): the row padded 24 (legacy Spacing.four) and the
 * room wrapped it in a view that padded 16 more, so a room's field was
 * inset 40pt a side and 222pt wide on a 402pt screen, while the one-to-one
 * thread, which has no wrapper, was inset 24. The component test
 * (features/chat/__tests__/composer) pins the row's own number; what is
 * pinned here is the ABSENCE of a second one, which only the text can show.
 */

describe('the room', () => {
  it('no longer pads the composer wrapper horizontally', () => {
    const code = source('src/app/room/[id].tsx');
    const wrap = between(code, 'composerWrap: {', '},');
    // The property, on its own line: a comment explaining its absence is
    // allowed to name it.
    expect(wrap).not.toMatch(/^\s+paddingHorizontal:/m);
  });
});

describe('the one-to-one thread', () => {
  it('keeps no composer style of its own, the shared one is the composer', () => {
    // A dead `composer` style beside the shared component was how the two
    // drifted the first time: somebody changing the number here would
    // change nothing on screen and think they had.
    const code = source('src/app/chat/[id].tsx');
    expect(code).not.toMatch(/^  composer: \{/m);
  });
});

describe('the composer', () => {
  it('is on the Space scale, with nothing left on the legacy one', () => {
    // Two scales in one file is how a 24 (Spacing.four) sat beside a 16
    // (Space.lg) and read as two different kinds of number. Space.xl is
    // the same 24, so this alone does not pin the inset; the component test
    // does that. This pins that the file reads one scale.
    const code = source('src/features/chat/composer.tsx');
    expect(code).not.toContain('Spacing.');
  });
});
