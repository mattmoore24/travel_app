import fs from 'node:fs';
import path from 'node:path';

/**
 * The conversation list, as the apps people already use draw one.
 *
 * The founder's words: "the actual chats themselves should look exactly like
 * chats are shown in iMessage before clicking into a specific message vs
 * spacing them out like we have now." What was there was a column of separate
 * filled cards with 16pt of air between them — a layout for a feed of
 * unrelated things, and the opposite of a list of conversations.
 *
 * These are source assertions because what is being guarded is geometry, and
 * geometry is exactly what a render test cannot see: it can tell you a name
 * appeared, not that the name sits in a continuous column with a hairline
 * threading the rows together.
 */
const source = (...parts: string[]): string =>
  fs
    .readFileSync(path.join(__dirname, '..', ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the chat list is a list, not a stack of cards', () => {
  const code = source('(tabs)', 'chat.tsx');

  it('draws conversations as flush rows with an inset separator', () => {
    expect(code).toContain('styles.separator');
    // Inset to where the text starts, so the avatars read as one column.
    expect(code).toContain('left: Space.lg + 10 + Space.md');
    // And the rows themselves cancel the scroller's gutter rather than
    // sitting inside it as cards.
    expect(code).toContain('marginHorizontal: -Spacing.four');
  });

  it('never gives a conversation row a card radius or fill', () => {
    const row = code.slice(code.indexOf('  row: {'), code.indexOf('  unreadGutter: {'));
    expect(row).not.toContain('borderRadius');
    expect(row).not.toContain('backgroundColor');
  });

  it('reserves both preview lines so every row is the same height', () => {
    // A list whose rows change height as messages arrive cannot be scanned by
    // position, and the ragged column of timestamps is what reads as ugly.
    expect(code).toMatch(/rowPreview: \{\s*height: PREVIEW_LINES \* Type\.callout\.lineHeight,/);
    expect(code).toContain('const PREVIEW_LINES = 2;');
  });

  it('scales the reserved preview height with the reader text size', () => {
    // The unscaled product is exactly two callout lines at the DEFAULT text
    // size, with no slack, so a fixed 40 clipped the second line at the first
    // Dynamic Type step up — and the second line is where the message is.
    expect(code).toContain('PREVIEW_LINES * Type.callout.lineHeight * fontScale');
    // Every row that draws a preview has to spend the scaled value, not the style.
    expect(
      code.match(/style=\{\[styles\.rowPreview, \{ height: previewHeight \}\]\}/g)
    ).toHaveLength(3);
  });

  it('puts the unread mark outside the text column', () => {
    expect(code).toContain('styles.unreadGutter');
    expect(code).toMatch(/unreadGutter: \{\s*width: 10,/);
  });

  it('draws the destinations as rows too, not as cards among rows', () => {
    // Founder, after the first pass: the Groups tab is what still looks
    // wrong. "Have an invite?", the rooms near you and "Archived" were filled
    // slabs interrupting a column of flush rows, which is the half-and-half
    // iMessage never does anywhere on that screen.
    expect(code).toContain('function PlainRow(');
    expect(code).not.toContain('styles.chatRow');
    expect(code).not.toContain('styles.chatRowText');
    // A destination is told apart by its chevron and a quieter glyph, not by
    // living in a different container.
    expect(code).toContain('chevron\n');
  });

  it('always starts a chat from the plus button, on either segment', () => {
    // It used to change under the person's hand: a new group on Groups, the
    // Travelers tab on Chats. Founder: "The plus button should always operate
    // in the same way as it does when I have groups selected."
    expect(code).toContain('accessibilityLabel="Start a chat"');
    expect(code).toContain("onPress={() => router.push('/new-group')}");
    expect(code).not.toContain("tab === 'groups' ? '/new-group' : '/travelers'");
  });
});
