import { between, source } from '@/lib/__tests__/source';

/**
 * The composer's inset lives in exactly one place, and it is the thread's.
 *
 * E2E run 142 (zz-ax5-07): the row padded 24 (legacy Spacing.four) and the
 * room wrapped it in a view that padded 16 more, so a room's field was
 * inset 40pt a side and 222pt wide on a 402pt screen, while the one-to-one
 * thread, which has no wrapper, was inset 24, and the bubbles above both
 * were set in 12. The component test (features/chat/__tests__/composer)
 * pins the row's own number; what is pinned here is the ABSENCE of a second
 * one, and that the thread's list and the composer read the same constant,
 * which only the text can show.
 */

describe('the room', () => {
  it('no longer insets the composer wrapper horizontally, by any spelling', () => {
    const code = source('src/app/room/[id].tsx');
    const wrap = between(code, 'composerWrap: {', '},');
    // Any horizontal padding or margin re-creates the 40pt field; the one
    // property the block keeps is named positively so the block itself
    // cannot quietly disappear either.
    expect(wrap).not.toMatch(/^\s+(padding|margin)(Horizontal|Left|Right|Start|End)?:/m);
    expect(wrap).toMatch(/^\s+paddingBottom: Space\.sm,/m);
  });

  it('sets the "added you" note in by the thread inset, the composer number', () => {
    const code = source('src/app/room/[id].tsx');
    const note = between(code, 'addedNote: {', '},');
    expect(note).toMatch(/^\s+marginHorizontal: ThreadInset,/m);
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

describe('the composer and the thread', () => {
  it('read one constant for the inset, so the field and the bubbles keep one edge', () => {
    const composer = source('src/features/chat/composer.tsx');
    const row = between(composer, '  composer: {', '},');
    expect(row).toMatch(/^\s+paddingHorizontal: ThreadInset,/m);
    const thread = source('src/features/chat/message-thread.tsx');
    const list = between(thread, '  list: {', '},');
    expect(list).toMatch(/^\s+paddingHorizontal: ThreadInset,/m);
  });

  it('is on the Space scale, with nothing left on the legacy one', () => {
    // Two scales in one file is how a 24 (Spacing.four) sat beside a 16
    // (Space.lg) and read as two different kinds of number.
    const code = source('src/features/chat/composer.tsx');
    expect(code).not.toContain('Spacing.');
  });
});
