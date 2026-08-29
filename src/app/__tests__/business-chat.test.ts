import fs from 'node:fs';
import path from 'node:path';

/**
 * Every chat surface, read as a business account.
 *
 * This is the screen a business lives in: travelers write in, the owner
 * answers. The founder tested it and found a tab badge pointing at "No chats
 * yet", a tap on the customer's name that did nothing, and a menu offering
 * to delete the customer's copy of the conversation. Each of those was one
 * traveler assumption left in a shared screen, so each one is pinned here by
 * the exact string that fixes it.
 *
 * Source-reading, like business-cannot-join: these screens need a session, a
 * router and a live query client to render, and what has to stay true is a
 * property of the code rather than of one rendered state.
 */
const REPO = path.join(__dirname, '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, file), 'utf8');

const CHAT_TAB = 'src/app/(tabs)/chat.tsx';
const CHAT_THREAD = 'src/app/chat/[id].tsx';
const ROOM = 'src/app/room/[id].tsx';

describe('the chat list a business reads', () => {
  it('does not filter a business out of its own room', () => {
    const code = src(CHAT_TAB);
    // The Chats/Groups switch is hidden for a business, so `tab` is stuck on
    // 'individual' and the traveler filter under it dropped every
    // kind === 'room' row - which for a business is the one room it runs.
    expect(code).toContain(
      "const ownRoom = isBusiness ? chats.filter((c) => c.kind === 'room') : [];"
    );
    expect(code).toContain(
      "const inTab = isBusiness\n    ? chats.filter((c) => c.kind !== 'room')"
    );
  });

  it('gives that room a section of its own', () => {
    const code = src(CHAT_TAB);
    const heading = code.indexOf('Your room');
    expect(heading).toBeGreaterThan(-1);
    expect(code).toContain('<OwnRoomRow key={chat.chat_id} chat={chat} />');
    // Pin and archive are housekeeping for a list of many conversations. In a
    // section of one they change nothing anybody can see, so the row carries
    // mute and nothing else.
    expect(code).toContain("text: chat.muted ? 'Unmute' : 'Mute',");
    expect(code.indexOf('function OwnRoomRow')).toBeGreaterThan(-1);
    // The row is a plain press, not a ChatRowLink: no swipe-to-archive on the
    // one room a business cannot get back by any other route.
    expect(code).not.toContain('<ChatRowLink key={chat.chat_id} chat={chat} last />');
  });

  it('never offers a business the hello loop, in either direction', () => {
    const code = src(CHAT_TAB);
    // Nobody says hi to a business: travelers write in through
    // message_business, which opens a conversation rather than a request.
    expect(code).toContain("{requests.length > 0 && tab === 'individual' && !isBusiness ? (");
    expect(code).toContain("{tab === 'individual' && waitingOnThem.length > 0 && !isBusiness ? (");
    expect(code).toContain('requestsQuery.isError && !chatsQuery.isError && !isBusiness ? (');
  });

  it('says messages, not chats, when the inbox is empty', () => {
    expect(src(CHAT_TAB)).toContain("? 'No messages yet'");
  });
});

describe('the conversation a business answers', () => {
  it('does not push a traveler profile a business account cannot open', () => {
    const code = src(CHAT_THREAD);
    // /profile/[userId] is inside Stack.Protected guard={signedIn &&
    // onboarded}, and a business is never onboarded, so the route is not
    // mounted for it. Both taps that used to push it are gone: the header
    // name and the menu's first item.
    expect(code).toContain('const openIdentity = viewerIsBusiness\n    ? null');
    expect(code).toContain('disabled={openIdentity == null}');
    expect(code).toContain('onPress={openIdentity ?? undefined}');
    const menu = code.indexOf('const openMenu = () => {');
    const viewProfile = code.indexOf("{ label: 'View profile'");
    expect(menu).toBeGreaterThan(-1);
    expect(viewProfile).toBeGreaterThan(menu);
    // Present, but only on the branch that is not a business.
    expect(code).toContain('...(viewerIsBusiness\n        ? []');
  });

  it('offers Archive rather than an unmatch that deletes the traveler side', () => {
    const code = src(CHAT_THREAD);
    // unmatch_chat hard-deletes the chats row, which takes the conversation
    // away from the traveler too. A business tidying its inbox must not be
    // able to wipe a customer's copy of what it told them.
    expect(code).toContain("viewerIsBusiness\n        ? { label: 'Archive', run: archiveChat }");
    expect(code).toContain('pref.mutate({ chatId: chat.chat_id, archived: true });');
    // And the traveler still has the traveler wording.
    expect(code).toContain("{ label: 'Leave chat', destructive: true, run: confirmLeaveChat }");
  });

  it('promises a business only what blocking actually does for it', () => {
    const code = src(CHAT_THREAD);
    // "gone from the map and Travelers" names two traveler surfaces a
    // business account does not have.
    expect(code).toContain(
      "'They cannot write to you again, and this chat freezes. They are not told.'"
    );
  });

  it('does not ask for social handles a business chat can never unlock', () => {
    // §7 rule 4 as the business build tightened it: a chat with a business
    // unlocks nobody's personal handles, in either direction.
    expect(src(CHAT_THREAD)).toContain('{chat.other_user_id && !viewerIsBusiness ? (');
  });
});

describe('the room a business runs', () => {
  it('knows which room that is without asking business_for_chat', () => {
    const code = src(ROOM);
    // business_for_chat matches kind = 'business', which is a DM. A
    // business's public room is kind = 'room', so it answered null here for
    // everybody and the owner fell through as an ordinary visitor.
    expect(code).toContain(
      'const isOwnRoom = ownBusiness?.chat_id != null && ownBusiness.chat_id === id;'
    );
    expect(code).toContain(
      'const placeId = isOwnRoom ? (ownBusiness?.id ?? null) : (chatPlaceId ?? null);'
    );
  });

  it('hands the owner the moderation controls the server already grants', () => {
    const code = src(ROOM);
    // my_chats sets my_role only where a groups row exists, so the owner of a
    // business room reads NULL - while is_room_moderator returns true for
    // them (20260827160000).
    expect(code).toContain("const isModerator = membership?.my_role === 'admin' || isOwnRoom;");
    // Which is what decides Remove-versus-Report and whether pinning exists.
    expect(code).toContain("reportLabel={isModerator ? 'Remove' : 'Report'}");
  });

  it('never offers the owner a way to leave the chat it runs', () => {
    const code = src(ROOM);
    expect(code).toContain('{isMember && !isOwnRoom ? (');
    expect(code).toContain('isMember && !viewerIsBusiness ? (');
  });

  it('tells the owner they run the room instead of telling them to join in', () => {
    const code = src(ROOM);
    expect(code).toContain('{chatsQuery.isPending ? null : isOwnRoom ? (');
    expect(code).toContain('here · you run this chat');
    // And in somebody else's room a business is not told to join in either.
    expect(code).toContain("? 'Anyone can read this chat.'");
    expect(code).toContain(": 'Anyone can read this chat. Join in to post.'");
  });

  it('leaves message avatars untappable for a business', () => {
    const code = src(ROOM);
    // Same guard as a guest, same reason: /profile/[userId] is not mounted,
    // so the push is a tap that is allowed to do nothing.
    expect(code).toContain('isGuest || viewerIsBusiness\n                ? undefined');
  });

  it('still keeps the checkout date and the join button behind the business check', () => {
    const code = src(ROOM);
    const guard = code.indexOf(') : viewerIsBusiness ? (');
    const question = code.indexOf('When do you check out?');
    const picker = code.indexOf('CHECKING OUT');
    const join = code.indexOf('label="Join this room"');
    expect(guard).toBeGreaterThan(-1);
    // All three are downstream of the branch that turns a business away.
    expect(guard).toBeLessThan(question);
    expect(guard).toBeLessThan(picker);
    expect(guard).toBeLessThan(join);
  });
});
