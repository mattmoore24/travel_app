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
