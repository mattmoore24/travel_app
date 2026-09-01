import fs from 'node:fs';
import path from 'node:path';

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
    plan_date: null,
    public_preview: null,
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

/**
 * The number the tab badge shows and the number the home-screen icon shows
 * are the same number, and they are computed in two different languages.
 *
 * waitingTotal is TypeScript; waiting_counts() is SQL, because the push
 * worker has to know the count for somebody whose app is not running. Two
 * definitions of "waiting" that can drift apart is the whole risk in that
 * change. The pgTAP asserts the SQL against my_chats; this asserts that the
 * SQL still SAYS what this file does, clause by clause, so an edit to one
 * side is visible from the other.
 */
describe('the badge number, in both languages', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'supabase',
      'migrations',
      '20260902030000_the_icon_carries_the_count.sql'
    ),
    'utf8'
  );

  it('agrees with the SQL on a mixed inbox', () => {
    const inbox = [
      chat({ unread_count: 2 }),
      chat({ unread_count: 1, muted: true }),
      chat({ unread_count: 0 }),
      chat({ unread_count: 5, kind: 'room' }),
    ];
    // What the SQL counts, read off its own predicate: not archived, not
    // muted, and something in it from somebody else.
    const asSqlCounts =
      inbox.filter((c) => !c.archived && !c.muted && c.unread_count > 0).length + 1;
    expect(waitingTotal(inbox, 1)).toBe(asSqlCounts);
    expect(waitingTotal(inbox, 1)).toBe(3);
  });

  it('keeps the SQL saying the same four things', () => {
    // Muting is somebody saying do not interrupt me about this.
    expect(sql).toContain('and not coalesce(pref.muted, false)');
    // my_chats(false) is what the app reads, so an archived thread is off
    // the list on both sides.
    expect(sql).toContain('where pref.archived_at is null');
    // Your own message is not something you are waiting on.
    expect(sql).toContain('msg.sender_id <> u.id');
    // And nothing unscreened is ever counted.
    expect(sql).toContain("msg.moderation_status = 'approved'");
    // Plus the hellos, which is the term that is not about chats at all.
    expect(sql).toContain("where mr.recipient_id = u.id and mr.status = 'pending'");
  });
});
