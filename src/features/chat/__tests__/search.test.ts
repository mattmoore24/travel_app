import { filterChats } from '@/features/chat/search';
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
    last_message: 'see you at the hostel',
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

describe('filterChats', () => {
  const rows = [
    chat({ title: 'Lisbon dorm', last_message: 'kitchen at 8' }),
    chat({ title: 'Theo', last_message: 'see you at the hostel' }),
    chat({ title: 'Ana', last_message: null, first_message: 'saw your pin for the rooftop' }),
  ];

  it('matches a title, which is how somebody looks for a room by name', () => {
    expect(filterChats(rows, 'lisbon').map((c) => c.title)).toEqual(['Lisbon dorm']);
  });

  it('ignores case, because nobody types a group name the way it was saved', () => {
    expect(filterChats(rows, 'LISBON').map((c) => c.title)).toEqual(['Lisbon dorm']);
    expect(filterChats(rows, 'ThEo').map((c) => c.title)).toEqual(['Theo']);
  });

  it('matches the preview line, so a half-remembered sentence finds the chat', () => {
    expect(filterChats(rows, 'kitchen').map((c) => c.title)).toEqual(['Lisbon dorm']);
  });

  it('matches the opening message, the only text an unanswered chat has', () => {
    expect(filterChats(rows, 'rooftop').map((c) => c.title)).toEqual(['Ana']);
  });

  it('is the identity for an empty query, and for one that is only spaces', () => {
    expect(filterChats(rows, '')).toBe(rows);
    expect(filterChats(rows, '   ')).toBe(rows);
  });

  it('returns nothing when nothing matches, rather than everything', () => {
    expect(filterChats(rows, 'reykjavik')).toEqual([]);
  });

  it('does not fall over on the nulls every one of these fields can be', () => {
    const empty = [chat({ title: null, last_message: null, first_message: null })];
    expect(filterChats(empty, 'anything')).toEqual([]);
  });
});
