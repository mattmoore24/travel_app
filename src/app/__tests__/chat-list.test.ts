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
    // The reserved box moved OUT to a wrapper around the preview and the
    // privacy tail, so a row with a tail is exactly as tall as one without.
    // Same invariant, one level up.
    expect(rowModule.match(/<View style=\{\{ height: previewHeight \}\}>/g)).toHaveLength(1);
    expect(
      code.match(/style=\{\[rowStyles\.rowPreview, \{ height: previewHeight \}\]\}/g)
    ).toHaveLength(3);
  });

  it('dates a hello you sent instead of labelling it with a status', () => {
    // The trailing column used to print a fixed "Sent" whatever the row's
    // age, so a hello from three weeks ago in a city you have left looked
    // exactly as live as one from an hour ago. It is the conversation rows'
    // own helper now, so the two vocabularies match.
    expect(code).toContain("notDelivered ? 'Not delivered' : rowTimestamp(request.created_at)");
    expect(code).toMatch(/import \{ rowTimestamp \} from '@\/features\/chat\/separators';/);
  });

  it('never lets that column say anything about the other person', () => {
    // Rules 4 and 5 live in this one row: a sender may never learn a read or
    // a decline. sent_requests() collapses delivered, declined and expired
    // into a flat 'sent', and the nightly sweep does not even add a word - it
    // stamps expired_at and leaves the state alone, so an over-the-air update
    // meeting an older bundle cannot break it. The screen has nothing to
    // branch on there, and must not try.
    expect(code).not.toContain("'declined'");
    expect(code).not.toContain("'expired'");
    // The ONE thing it may now say, and the reason the rule reads this way
    // rather than banning the word: a message the classifier stopped AFTER
    // this screen confirmed it is our own moderation of the sender's own
    // text. Nothing about the recipient is in it, and the alternative was
    // deleting the only copy of what somebody wrote. So the only permitted
    // branch on 'blocked' is the after-send one, in the row and in the
    // filter that puts it there.
    expect(code.match(/'blocked'/g)).toHaveLength(1);
    expect(code).toContain("request.state === 'blocked' && request.blocked_after_send");
    expect(code).toContain('const waitingOnThem = waitingRows(sentRequests);');
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

  it('gives a room row a mark that says which of the three it is', () => {
    // Source assertions, because what is being guarded is which branch draws
    // which glyph, and the branch reads two columns my_chats only just grew.
    const rowKind = source('..', 'features', 'chat', 'row-kind.ts');
    expect(rowKind).toContain('chat.plan_date != null');
    expect(rowKind).toContain('chat.public_preview != null');
    expect(rowModule).toContain('roomBadgeGlyph(chat)');
    // The house is gone from both the conversation row and RoomDiscovery,
    // which lists businesses only.
    expect(rowModule).not.toContain('house.fill');
    expect(code).not.toContain('house.fill');
    expect(code).toContain("ios: 'storefront.fill'");
  });

  it('shows a group its own picture instead of a glyph, in the right bucket', () => {
    // my_chats returns g.photo_path, which only a traveler group ever has: a
    // business room has no groups row. Reaching for a cover here would sign a
    // business path through the chat bucket and come back a 404 wearing a
    // valid URL, which is the bug this row has already paid for once.
    expect(rowModule).toContain('isRoom && chat.photo_path');
    expect(rowModule).toContain('<GroupAvatar path={chat.photo_path} size={AVATAR} />');
    expect(rowModule).toContain('useChatPhotoUrl(path)');
  });

  it('says who else can read a room, in the room screen own words', () => {
    expect(rowModule).toContain('privacyTail(chat)');
    const rowKind = source('..', 'features', 'chat', 'row-kind.ts');
    expect(rowKind).toContain("'anyone with the pin can join'");
    expect(rowKind).toContain("'anyone can read'");
    expect(rowKind).toContain("'a business runs this chat'");
  });

  it('caps the waiting hellos instead of stacking them above the inbox', () => {
    // Eight waiting hellos was 1600pt of judgement calls between a returning
    // traveler and the conversation they opened the app for. Past two they
    // collapse to one flush row carrying the count and three faces, and the
    // cards themselves are read on /first-messages - one copy of the
    // accept/decline logic, not two.
    expect(code).toContain('const WAITING_COLLAPSE_AT = 3;');
    expect(code).toContain('requests.length >= WAITING_COLLAPSE_AT');
    expect(code).toContain("router.push('/first-messages')");
    // And each one is dated, so a hello from three weeks ago in a city you
    // have left does not read as urgently as one from an hour ago.
    const card = fs.readFileSync(
      path.join(__dirname, '..', '..', 'features', 'matching', 'incoming-request-card.tsx'),
      'utf8'
    );
    expect(card).toContain('rowTimestamp(request.created_at)');
    // The receiver's half of moderation stays on every card that is on
    // screen, never behind the collapse.
    expect(card).toContain('Does this feel off? Tell us.');
  });

  it('virtualizes the conversations instead of mounting every one of them', () => {
    // Every ChatRowLink mounts an Image and its own signed-URL query, so a
    // traveler three months into a trip with sixty conversations was firing
    // sixty signed-URL requests every time they opened one of three tabs.
    // This was the only unbounded list in the app that was not virtualized -
    // the thread has been a proper inverted FlatList since it was built.
    expect(code).toContain('<SectionList');
    const signedIn = code.slice(code.indexOf('const sections: ChatSection[] = []'));
    expect(signedIn).not.toContain('<ScrollView');
    // The guest branch stays a ScrollView: guestFill and guestCentre depend
    // on flexGrow, which a SectionList's contentContainerStyle handles
    // differently, and converting both in one change is how this goes wrong.
    expect(code).toContain('<ScrollView');
  });

  it('closes a swiped row when it scrolls out of sight', () => {
    // The classic virtualization pairing bug, and worse here than usual:
    // the action behind the swipe archives a conversation.
    expect(code).toContain('onViewableItemsChanged={closeSwipesOffScreen}');
    expect(code).toContain('registerSwipe?.(chat.chat_id, instance)');
    expect(code).toContain('swipeable.close()');
  });

  it('keeps the tap-through-the-keyboard rule on the virtualized list', () => {
    // 'always' rather than 'handled': 'handled' asks the responder chain
    // whether a child wants the touch, and the reaction menu's capture-phase
    // responder is exactly the kind of thing that answers wrongly.
    const list = code.slice(code.indexOf('<SectionList'));
    expect(list).toContain('keyboardShouldPersistTaps="always"');
    expect(list).toContain('refreshControl={');
  });

  it('gives the signed-out Chats segment a screen rather than a void', () => {
    // 04-chat-guest was roughly 600pt of nothing, then a left-aligned grey
    // footnote with no heading and no mark: one of three tabs reading as a
    // screen that failed to load, on the tab a curious visitor opens third.
    expect(code).toContain("ios: 'bubble.left.and.bubble.right.fill'");
    expect(code).toContain('Open chats at hostels and bars are under Groups.');
    // And the Groups segment keeps its own way in, which is the half of the
    // audit finding that was wrong: city_rooms is granted to anon.
    expect(code).toContain(
      '<RoomDiscovery cityName={cityName} rooms={rooms} query={roomsQuery} />'
    );
    // The pointer stays plain text. A Pressable carrying its own
    // accessibilityLabel hides the words inside it from Maestro, and the
    // words are what the guest tour asserts.
    expect(code).not.toContain('accessibilityLabel="Open chats');
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
