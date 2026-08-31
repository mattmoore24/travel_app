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
  // The row itself lives in one shared module now, so the archive cannot
  // diverge from the inbox again — the geometry assertions read it there.
  const rowModule = source('..', 'features', 'chat', 'chat-row.tsx');

  it('draws conversations as flush rows with an inset separator', () => {
    expect(rowModule).toContain('styles.separator');
    // Inset to where the text starts, so the avatars read as one column.
    expect(rowModule).toContain('left: Space.lg + 10 + Space.md');
    // And the rows themselves cancel the scroller's gutter rather than
    // sitting inside it as cards.
    expect(rowModule).toContain('marginHorizontal: -Spacing.four');
  });

  it('never gives a conversation row a card radius or fill', () => {
    const row = rowModule.slice(
      rowModule.indexOf('  row: {'),
      rowModule.indexOf('  unreadGutter: {')
    );
    expect(row).not.toContain('borderRadius');
    expect(row).not.toContain('backgroundColor');
  });

  it('reserves both preview lines so every row is the same height', () => {
    // A list whose rows change height as messages arrive cannot be scanned by
    // position, and the ragged column of timestamps is what reads as ugly.
    expect(rowModule).toMatch(
      /rowPreview: \{\s*height: PREVIEW_LINES \* Type\.callout\.lineHeight,/
    );
    expect(rowModule).toContain('export const PREVIEW_LINES = 2;');
  });

  it('scales the reserved preview height with the reader text size', () => {
    // The unscaled product is exactly two callout lines at the DEFAULT text
    // size, with no slack, so a fixed 40 clipped the second line at the first
    // Dynamic Type step up — and the second line is where the message is.
    expect(rowModule).toContain('PREVIEW_LINES * Type.callout.lineHeight * fontScale');
    // Every row that draws a preview has to spend the scaled value, not the
    // style: ChatRow in the module, and SentHelloRow, PlainRow and the
    // collapsed waiting row in the screen.
    expect(
      rowModule.match(/style=\{\[styles\.rowPreview, \{ height: previewHeight \}\]\}/g)
    ).toHaveLength(1);
    expect(
      code.match(/style=\{\[rowStyles\.rowPreview, \{ height: previewHeight \}\]\}/g)
    ).toHaveLength(3);
  });

  it('dates a hello you sent instead of labelling it with a status', () => {
    // The trailing column used to print a fixed "Sent" whatever the row's
    // age, so a hello from three weeks ago in a city you have left looked
    // exactly as live as one from an hour ago. It is the conversation rows'
    // own helper now, so the two vocabularies match.
    expect(code).toContain('{rowTimestamp(request.created_at)}');
    expect(code).toMatch(/import \{ rowTimestamp \} from '@\/features\/chat\/separators';/);
  });

  it('never lets that column become a status', () => {
    // Rules 4 and 5 live in this one row: a sender may never learn a read, a
    // decline, or a moderation stop. sent_requests() collapses all three
    // into a flat 'sent', and the nightly sweep does not even add a word -
    // it stamps expired_at and leaves the state alone, so that an
    // over-the-air update meeting an older bundle cannot break it. The
    // screen has nothing to branch on, and must not try.
    expect(code).not.toContain("'declined'");
    expect(code).not.toContain("'expired'");
    expect(code).not.toContain("'blocked'");
  });

  it('puts the unread mark outside the text column', () => {
    expect(rowModule).toContain('styles.unreadGutter');
    expect(rowModule).toMatch(/unreadGutter: \{\s*width: 10,/);
  });

  it('gives the archive the same row, not a divergent copy', () => {
    const archived = source('archived-chats.tsx');
    expect(archived).toContain("from '@/features/chat/chat-row'");
    expect(archived).toContain('<ChatRow chat={chat} last={last} />');
    // Its scroller pads Space.lg, not the inbox's Spacing.four, so it must
    // cancel ITS own gutter or the separators run off the screen edge.
    expect(archived).toMatch(/list: \{\s*marginHorizontal: -Space\.lg,/);
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

  it('names the browsing city instead of claiming the rooms are near anybody', () => {
    // The heading is derived from a trip the traveler typed, via
    // useBrowsingCity — never launchCities[0], which listed whatever city
    // came first in the launch table as "near you".
    expect(code).toContain('const { cityId, cityName } = useBrowsingCity();');
    expect(code).toContain('Rooms in ${cityName}');
  });

  it('keeps the plus button doing one thing, on either segment, and saying so', () => {
    // It used to change under the person's hand: a new group on Groups, the
    // Travelers tab on Chats. Founder: "The plus button should always operate
    // in the same way as it does when I have groups selected." And its label
    // now names the destination — it said "Start a chat" while opening
    // /new-group, on a screen that cannot start a one-to-one chat at all.
    expect(code).toContain('accessibilityLabel="New group"');
    expect(code).toContain("onPress={() => router.push('/new-group')}");
    expect(code).not.toContain("tab === 'groups' ? '/new-group' : '/travelers'");
  });
});

/**
 * §7 rule 2 as vocabulary: the app never knows where anybody is, so no chat
 * surface may SAY it does. "1 guest here now" and "Rooms near you" both
 * shipped, in the app whose loudest promise is that it never collects or
 * displays location. Counts are chat membership ("in this chat"), and the
 * room list is titled with a city the traveler typed a trip to.
 *
 * Two blocks so a failure names which banned phrase came back. Comments are
 * stripped by source(), so prose about the old strings stays legal.
 */
describe('the chat surfaces never claim presence', () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === '__tests__' ? [] : walk(full);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });

  const surfaces: [string, string][] = [
    ['src/app/(tabs)/chat.tsx', source('(tabs)', 'chat.tsx')],
    ['src/app/room/[id].tsx', source('room', '[id].tsx')],
    ...walk(path.join(__dirname, '..', '..', 'features', 'chat')).map((file): [string, string] => [
      path.relative(path.join(__dirname, '..', '..', '..'), file),
      fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, ''),
    ]),
  ];

  it.each(surfaces)('%s never says "here now"', (_file, code) => {
    expect(code).not.toMatch(/here now/i);
  });

  it.each(surfaces)('%s never says "near you"', (_file, code) => {
    expect(code).not.toMatch(/near you/i);
  });
});
