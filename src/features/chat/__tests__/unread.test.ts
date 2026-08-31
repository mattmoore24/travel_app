import { firstUnreadId, isWaiting, waitingInSegment, waitingTotal } from '@/features/chat/unread';
import type { ChatListRow } from '@/lib/database.types';

function chat(over: Partial<ChatListRow>): ChatListRow {
  return {
    chat_id: Math.random().toString(36).slice(2),
    kind: 'direct',
    chat_status: 'active',
    title: 'Theo',
    other_user_id: 'u',
    photo_path: null,
    first_message: null,
    first_message_sender_id: null,
    last_message: 'hi',
    last_message_at: new Date().toISOString(),
    member_count: null,
    pinned: false,
    muted: false,
    archived: false,
    expires_at: null,
    created_at: new Date().toISOString(),
    my_role: null,
    unread_count: 0,
    first_message_element: null,
    ...over,
  };
}

describe('isWaiting', () => {
  it('is true only when somebody has actually written', () => {
    expect(isWaiting(chat({ unread_count: 0 }))).toBe(false);
    expect(isWaiting(chat({ unread_count: 1 }))).toBe(true);
  });

  it('is false for a muted chat, however loud it is', () => {
    expect(isWaiting(chat({ unread_count: 40, muted: true }))).toBe(false);
  });
});

describe('waitingInSegment', () => {
  const chats = [
    chat({ unread_count: 2 }),
    chat({ unread_count: 0 }),
    chat({ kind: 'room', unread_count: 5 }),
    chat({ kind: 'room', unread_count: 5, muted: true }),
  ];

  it('counts one-to-one chats on the Chats side', () => {
    expect(waitingInSegment(chats, false)).toBe(1);
  });

  it('counts rooms and groups on the Groups side, skipping muted ones', () => {
    expect(waitingInSegment(chats, true)).toBe(1);
  });
});

describe('waitingTotal', () => {
  it('counts conversations, not messages, so one busy room cannot shout', () => {
    expect(waitingTotal([chat({ kind: 'room', unread_count: 250 })], 0)).toBe(1);
  });

  it('adds hellos still waiting on an answer', () => {
    expect(waitingTotal([chat({ unread_count: 1 })], 2)).toBe(3);
  });

  it('is zero when there is genuinely nothing waiting', () => {
    expect(
      waitingTotal([chat({ unread_count: 0 }), chat({ muted: true, unread_count: 9 })], 0)
    ).toBe(0);
  });
});

/**
 * The New line has one input the app can trust - the count the server already
 * computed - and one job: never point at the wrong message. Every case below
 * is a way it could point at the wrong one.
 */
describe('firstUnreadId', () => {
  const said = (id: string, sender: string) => ({ id, sender_id: sender });
  // Newest first, the way an inverted thread reads.
  const thread = [
    said('m5', 'them'),
    said('m4', 'them'),
    said('m3', 'me'),
    said('m2', 'them'),
    said('m1', 'me'),
  ];

  it('is nothing at all when nothing is waiting', () => {
    expect(firstUnreadId(thread, 'me', 0)).toBeNull();
  });

  it('walks back from the newest and lands on the oldest unread', () => {
    expect(firstUnreadId(thread, 'me', 1)).toBe('m5');
    expect(firstUnreadId(thread, 'me', 2)).toBe('m4');
  });

  it('does not count your own messages, whenever you sent them', () => {
    // Three unread means three from other people: m5, m4 and m2, with your
    // own m3 in the middle counting for nothing.
    expect(firstUnreadId(thread, 'me', 3)).toBe('m2');
  });

  it('refuses to place a boundary that is off the loaded page', () => {
    // A line in the wrong place is worse than no line. Paging makes this
    // temporary: the same walk succeeds once the older page arrives.
    expect(firstUnreadId(thread, 'me', 4)).toBeNull();
  });

  it('ignores a message that has not left the device', () => {
    const sending = [{ id: 'local:1', sender_id: 'them' }, ...thread];
    expect(firstUnreadId(sending, 'me', 1)).toBe('m5');
  });

  it('ignores the opening message carried on the chat row', () => {
    // It is not in the messages table, so the server never counted it, and
    // its made-up id is not one anything may anchor to.
    const withFirst = [...thread, { id: 'first:abc', sender_id: 'them' }];
    expect(firstUnreadId(withFirst, 'me', 4)).toBeNull();
  });

  it('is nothing at all in a thread of only your own messages', () => {
    expect(firstUnreadId([said('m1', 'me')], 'me', 1)).toBeNull();
  });
});
