import { planChipLabel, privacyTail, roomBadgeGlyph } from '@/features/chat/row-kind';
import type { ChatListRow } from '@/lib/database.types';

/**
 * The two sentences a conversation row says about what kind of thing it is.
 *
 * They exist because the inbox listed a private crew, a plan any stranger who
 * can see the pin walks into, and a hostel room a signed-out visitor can read,
 * under one heading and one glyph. Somebody typing "I am at the hostel on Rua
 * X until Tuesday" had no way to know which of the three they were typing into.
 */

const room = (over: Partial<ChatListRow> = {}): ChatListRow => ({
  chat_id: 'c1',
  kind: 'room',
  chat_status: 'active',
  title: 'Maestro crew',
  other_user_id: null,
  photo_path: null,
  first_message: null,
  first_message_sender_id: null,
  last_message: null,
  last_message_at: null,
  member_count: 4,
  pinned: false,
  muted: false,
  archived: false,
  expires_at: null,
  created_at: '2026-09-01T10:00:00.000Z',
  my_role: 'admin',
  unread_count: 0,
  first_message_element: null,
  plan_date: null,
  public_preview: null,
  ...over,
});

describe('the day a plan is for', () => {
  // Fixed so the test does not change meaning at midnight.
  const now = new Date(2026, 8, 2, 19, 0, 0);

  it('says nothing when there is no plan', () => {
    expect(planChipLabel(null, now)).toBeNull();
  });

  it('names today, short and unambiguous', () => {
    // Never '9/2': a numeric date means September 2 to an American and 9
    // February to nearly everybody else this app is for. Same 'en' vocabulary
    // as the trailing timestamp column, so one row speaks one language.
    expect(planChipLabel('2026-09-02', now)).toBe('Wed, Sep 2');
  });

  it('names a day still to come', () => {
    expect(planChipLabel('2026-09-05', now)).toBe('Sat, Sep 5');
  });

  it('goes quiet once the day has passed', () => {
    // The group outlives the pin on purpose, and a room still stamped with
    // last Tuesday is a list telling somebody a plan is on when it is over.
    expect(planChipLabel('2026-09-01', now)).toBeNull();
  });

  it('keeps tonight on the row all evening, wherever the reader is', () => {
    // Compared as ISO day strings, not as instants: `new Date('2026-09-02')`
    // is midnight UTC, which is still 1 September in Lisbon at 23:00, and the
    // date must not vanish while the evening it names is going on.
    expect(planChipLabel('2026-09-02', new Date(2026, 8, 2, 23, 30))).toBe('Wed, Sep 2');
  });
});

describe('who else can read this conversation', () => {
  it('says nothing about a one-to-one chat', () => {
    expect(privacyTail(room({ kind: 'direct', my_role: null }))).toBeNull();
  });

  it('says nothing about a private crew', () => {
    // Silence is the correct statement here, and a tail on every row is a
    // tail nobody reads on any of them.
    expect(privacyTail(room())).toBeNull();
  });

  it('warns that a plan is open to whoever can see the pin', () => {
    // post_joinable_pin opens the group with speaking = 'everyone' and
    // join_pin_chat asks for nothing but pin visibility, so this is the exact
    // rule the database enforces.
    expect(privacyTail(room({ plan_date: '2026-09-05' }))).toBe('anyone with the pin can join');
  });

  it('warns about the plan even when the reader runs it', () => {
    expect(privacyTail(room({ plan_date: '2026-09-05', my_role: 'admin' }))).toBe(
      'anyone with the pin can join'
    );
  });

  it('says a public hostel room can be read by anyone', () => {
    expect(privacyTail(room({ my_role: null, public_preview: true }))).toBe('anyone can read');
  });

  it('names the business behind a room that is not public', () => {
    expect(privacyTail(room({ my_role: null, public_preview: false }))).toBe(
      'a business runs this chat'
    );
  });

  it('carries no em dash and none of the banned vocabulary', () => {
    const sentences = [
      privacyTail(room({ plan_date: '2026-09-05' })),
      privacyTail(room({ my_role: null, public_preview: true })),
      privacyTail(room({ my_role: null, public_preview: false })),
      planChipLabel('2026-09-05', new Date(2026, 8, 2)),
    ].join(' ');
    expect(sentences).not.toContain('—');
    expect(sentences).not.toMatch(/\b(swipe|deck|match|request|place)\b/i);
    // §7 rule 2: no chat surface may claim to know where anybody is.
    expect(sentences).not.toMatch(/here now|near you|nearby/i);
  });
});

describe('the mark on a room row', () => {
  it('draws a marker on a plan, because that is what the person tapped', () => {
    expect(roomBadgeGlyph(room({ plan_date: '2026-09-05' }))).toEqual({
      ios: 'mappin.and.ellipse',
      android: 'place',
      web: 'place',
    });
  });

  it('draws a storefront on a business room, from either side of it', () => {
    const storefront = { ios: 'storefront.fill', android: 'storefront', web: 'storefront' };
    expect(roomBadgeGlyph(room({ public_preview: true }))).toEqual(storefront);
    expect(roomBadgeGlyph(room({ public_preview: false }))).toEqual(storefront);
  });

  it('draws people on a travelers group', () => {
    expect(roomBadgeGlyph(room())).toEqual({
      ios: 'person.3.fill',
      android: 'groups',
      web: 'groups',
    });
  });

  it('lets an expired plan become an ordinary group', () => {
    // plan_date goes null with the pin, and the room is a group from then on.
    // Leaving a marker on it would promise a plan that has burned out.
    expect(roomBadgeGlyph(room({ plan_date: null }))).toEqual(roomBadgeGlyph(room()));
  });

  it('never draws the house again', () => {
    // One glyph for three privacy models is what this replaced. The house
    // survives in exactly one place, business/vocabulary.ts, where it means
    // the guesthouse CATEGORY and is about a building.
    const every = JSON.stringify([
      roomBadgeGlyph(room({ plan_date: '2026-09-05' })),
      roomBadgeGlyph(room({ public_preview: true })),
      roomBadgeGlyph(room()),
    ]);
    expect(every).not.toContain('house.fill');
    expect(every).not.toContain("'home'");
  });
});
