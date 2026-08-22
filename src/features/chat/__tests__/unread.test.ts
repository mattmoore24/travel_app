import { isWaiting, waitingInSegment, waitingTotal } from '@/features/chat/unread';
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
