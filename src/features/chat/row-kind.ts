import type { SymbolViewProps } from 'expo-symbols';

import type { ChatListRow } from '@/lib/database.types';

/**
 * What kind of thing a conversation row is, in words and in a date.
 *
 * The inbox lists three objects with three privacy models under one heading:
 * a private crew, a plan hung off a pin that anybody who can see the pin can
 * walk into, and a business room a signed-out visitor can read. The room
 * screen says which is which once you are inside it. The list, which is where
 * somebody decides what to type, said nothing at all.
 *
 * Both helpers live here rather than inside the row so they can be tested
 * as the sentences they are.
 */

/**
 * `pins.intent_date` is a DATE, so it has no time on it and nothing to show
 * beyond the day. Short weekday, day, short month: unambiguous in every
 * Latin-script locale, and narrow enough to sit beside a name.
 */
const PLAN_DAY = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/**
 * The day a plan is for, or null when there is nothing worth saying.
 *
 * Null once the day has passed: a group outlives the pin it opened from on
 * purpose (groups.pin_id is ON DELETE SET NULL), so a room whose night is
 * over is an ordinary group, and stamping it with a date that has gone is
 * how a list starts lying about what is still on.
 */
export function planChipLabel(planDate: string | null, now: Date = new Date()): string | null {
  if (!planDate) {
    return null;
  }
  // Compared as ISO day strings, not as instants. `new Date('2026-09-02')` is
  // midnight UTC, which is still yesterday for a traveler west of Greenwich,
  // and a plan should not disappear off the row while the evening it is for
  // is still going on around the reader.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  if (planDate < today) {
    return null;
  }
  const [year, month, day] = planDate.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return PLAN_DAY.format(new Date(year, month - 1, day));
}

/**
 * Who else can read this conversation, appended to the preview line.
 *
 * The room screen's own words, so a person who has been inside one reads the
 * same sentence in the list. A private crew gets nothing: silence is the
 * correct statement about a group only its members can open, and a tail on
 * every row would make the tails invisible.
 */
export function privacyTail(
  chat: Pick<ChatListRow, 'kind' | 'plan_date' | 'my_role' | 'public_preview'>
): string | null {
  if (chat.kind !== 'room') {
    return null;
  }
  if (chat.plan_date != null) {
    // Exactly what join_pin_chat enforces: seeing the pin is the whole
    // admission test, and there is no token in it.
    return 'anyone with the pin can join';
  }
  if (chat.my_role != null) {
    return null;
  }
  if (chat.public_preview === true) {
    return 'anyone can read';
  }
  if (chat.public_preview === false) {
    return 'a business runs this chat';
  }
  return null;
}

/**
 * The mark on a room row.
 *
 * The list drew one house on all three of them. The recorded objection to
 * changing that (chat-row.tsx, before this) was that `kind === 'room'` covers
 * a hostel's guest room as well as a travelers' group, and that a business
 * under three little people would be wrong about what it is. Correct, and
 * answered rather than overruled: a business gets the storefront the map and
 * PlaceAvatar already use for one, so this also closes a cross-screen
 * inconsistency. What is left is a plan, which takes the marker the person
 * tapped to get into it, and a travelers' group, which is people.
 *
 * An EXPIRED plan falls through to the group mark, because that is what it
 * has become: plan_date goes null with the pin and the conversation carries
 * on as an ordinary group.
 */
export function roomBadgeGlyph(
  chat: Pick<ChatListRow, 'plan_date' | 'public_preview'>
): SymbolViewProps['name'] {
  if (chat.plan_date != null) {
    return { ios: 'mappin.and.ellipse', android: 'place', web: 'place' };
  }
  if (chat.public_preview != null) {
    return { ios: 'storefront.fill', android: 'storefront', web: 'storefront' };
  }
  return { ios: 'person.3.fill', android: 'groups', web: 'groups' };
}
