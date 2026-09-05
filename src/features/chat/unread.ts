import { useEffect, useState } from 'react';

import { isLocalId } from '@/features/chat/outgoing';
import type { ChatListRow } from '@/lib/database.types';

/**
 * One definition of "waiting", shared by the tab badge and the segment
 * counts so the two can never disagree with each other.
 *
 * A muted chat is never waiting. Muting is a person saying "do not interrupt
 * me about this", and a badge is an interruption — the row keeps its own dot,
 * so nothing is hidden, it just stops shouting.
 */
export function isWaiting(chat: ChatListRow): boolean {
  return !chat.muted && chat.unread_count > 0;
}

/** Waiting conversations on one side of the Chats / Groups switch. */
export function waitingInSegment(chats: ChatListRow[], groups: boolean): number {
  return chats.filter((chat) => (chat.kind === 'room') === groups && isWaiting(chat)).length;
}

/**
 * What the Chat tab's badge counts: conversations with something new, plus
 * hellos waiting on an answer.
 *
 * Conversations, not messages — one chatty hostel room must not be able to
 * make the app look like an emergency.
 */
export function waitingTotal(chats: ChatListRow[], pendingRequests: number): number {
  return chats.filter(isWaiting).length + pendingRequests;
}

/**
 * The oldest message this reader has not seen, or null when the line cannot
 * be drawn honestly.
 *
 * The count is all there is to work with: my_chats returns unread_count and no
 * last_read_at, and no other RPC exposes one. So the boundary is found by
 * walking BACK from the newest message and counting the same things the server
 * counted - what somebody else wrote, that actually exists.
 *
 * "The same things" is exact, and it has to be. my_chats counts only rows with
 * `removed_at is null and unsent_at is null and moderation_status = 'approved'`
 * (20260830000000_a_business_is_served_no_travelers.sql:535-549). A walk that
 * counted anything else would stop on the wrong message and draw the New line
 * BELOW something genuinely unread: send a photo that is still with the
 * moderation worker and two texts after it, and a walk that counted the photo
 * would put the line under the newer text and hide the older one for good,
 * because the count is gone the moment the reader arrives. So every predicate
 * below is the server's, not a reasonable-looking approximation of it.
 *
 * Null in three cases, and each one matters. A count of zero has no boundary.
 * A count larger than the loaded page cannot be placed, and a line drawn in
 * the wrong place is worse than no line - with paging that answer is not
 * final, because the next page loads and the same walk succeeds. And a thread
 * of nothing but your own messages has nothing waiting in it.
 */
/**
 * One row as the walk needs to see it. Both thread shapes carry all of this:
 * a direct chat has removed_at and moderation_status, a room row has `removed`
 * and photo_state, and the two screens already map one onto the other.
 */
export type UnreadCountable = {
  id: string;
  sender_id: string;
  unsent_at?: string | null;
  removed_at?: string | null;
  removed?: boolean;
  moderation_status?: 'pending' | 'approved' | 'rejected';
  photo_state?: 'none' | 'ready' | 'checking' | 'blocked';
};

/** The server's own predicate, in the client's vocabulary. */
function serverWouldCount(message: UnreadCountable): boolean {
  if (message.unsent_at != null) {
    return false;
  }
  if (message.removed_at != null || message.removed === true) {
    return false;
  }
  // A direct chat carries the verdict itself; a room carries it as the photo's
  // state, and 'checking' is the pending case the server has not counted yet.
  if (message.moderation_status != null && message.moderation_status !== 'approved') {
    return false;
  }
  if (message.photo_state === 'checking' || message.photo_state === 'blocked') {
    return false;
  }
  return true;
}

export function firstUnreadId(
  messages: readonly UnreadCountable[],
  ownUserId: string | null,
  unreadCount: number
): string | null {
  if (unreadCount <= 0) {
    return null;
  }
  let counted = 0;
  for (const message of messages) {
    // Synthetic rows are excluded from anything that reads their id as a real
    // one: a placeholder has not been sent, and the opening message carried on
    // the chat row is not in the messages table at all.
    if (isLocalId(message.id) || message.id.startsWith('first:')) {
      continue;
    }
    if (ownUserId != null && message.sender_id === ownUserId) {
      continue;
    }
    if (!serverWouldCount(message)) {
      continue;
    }
    counted += 1;
    if (counted === unreadCount) {
      return message.id;
    }
  }
  return null;
}

/**
 * How much was waiting when a thread opened, kept for as long as it is open.
 *
 * The count falls to zero the moment the reader arrives - that is what opening
 * a conversation MEANS - so the boundary has to be captured before it does, and
 * then held. Held is the important half: without it a refetch would move the
 * New line under somebody in the middle of reading.
 *
 * It wins the race comfortably. useMarkReadWhileOpen marks the chat read
 * through an RPC and only invalidates the chat list once that has come back,
 * so the count cannot fall until a round trip has completed, while this lands
 * on the commit after the first paint. Pass null while there is no row to read
 * the count from yet.
 */
export function useUnreadAtOpen(unreadCount: number | null): number {
  const [latched, setLatched] = useState<number | null>(null);
  useEffect(() => {
    if (unreadCount == null || latched != null) {
      return;
    }
    // A latch, not a subscription: it runs at most once per screen, so the
    // cascading-render cost the rule is about is one extra commit on open.
    // The alternative, writing a ref during render, is forbidden outright by
    // react-hooks/refs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLatched(unreadCount);
  }, [unreadCount, latched]);
  return latched ?? 0;
}

/**
 * Load older pages until the New line can actually be placed.
 *
 * Without this the divider and the paging fight, and the case they fight over
 * is the one the whole feature was written for: join a hostel room, spend the
 * day on a walking tour, come back to eighty messages. A page is sixty, so the
 * walk runs off the end, firstUnreadId returns null, and there is no line and
 * no opening jump - the reader has to scroll back through a screenful by hand
 * before onEndReached fetches the page that would have answered it. The guard
 * itself is right (a line in the wrong place is worse than no line); what was
 * missing is the step that makes it temporary.
 *
 * Bounded twice over: it only runs while the boundary is still unplaced and a
 * page is still available, and it asks for ONE page per settled fetch, so a
 * count the server got wrong cannot walk the whole history.
 */
export function useReachUnreadBoundary(input: {
  unreadAtOpen: number;
  /**
   * How many rows are loaded. Deliberately the raw count rather than "was the
   * boundary found": this has to be callable ABOVE a screen's early return
   * for a chat that has not arrived yet, and the walk's answer is not
   * available there. The count is an upper bound on what the walk can reach -
   * it can never find an Nth message from somebody else among fewer than N
   * rows - so it asks for another page in exactly the cases the walk would
   * have failed, and stops one page later than a precise test would at worst.
   */
  loadedCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}): void {
  const { unreadAtOpen, loadedCount, hasNextPage, isFetchingNextPage, fetchNextPage } = input;
  useEffect(() => {
    if (unreadAtOpen <= 0 || loadedCount >= unreadAtOpen || !hasNextPage || isFetchingNextPage) {
      return;
    }
    fetchNextPage();
  }, [unreadAtOpen, loadedCount, hasNextPage, isFetchingNextPage, fetchNextPage]);
}
