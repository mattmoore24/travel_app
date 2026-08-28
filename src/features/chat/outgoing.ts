import type { MessageRow, RoomMessageRow } from '@/lib/database.types';

/**
 * A message in the thread cache, which may not have reached the server yet.
 *
 * `local` is the whole delivery ladder. It exists because a message that goes
 * nowhere for a second and then appears is indistinguishable, from the
 * sender's side, from a composer that ate their sentence — and because the
 * first message between two people goes through moderation, so "nothing
 * happened yet" is the NORMAL case here rather than the rare one.
 */
export type ThreadMessage = MessageRow & { local?: 'sending' | 'failed' };
export type RoomThreadMessage = RoomMessageRow & { local?: 'sending' | 'failed' };

/**
 * The prefix that marks a row the server has never seen. Real ids are uuids,
 * so nothing can collide with it.
 */
const LOCAL_PREFIX = 'local:';

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

/**
 * A local id that is unique within one thread without a random source.
 *
 * Deliberately derived from the send time rather than Math.random: two sends
 * in the same millisecond are not a thing a person can do, and a deterministic
 * id is one less thing to reason about when a retry replaces a row.
 */
export function localId(at: Date): string {
  return `${LOCAL_PREFIX}${at.getTime()}`;
}

export function optimisticMessage(input: {
  chatId: string;
  senderId: string;
  body: string;
  at?: Date;
}): ThreadMessage {
  const at = input.at ?? new Date();
  return {
    id: localId(at),
    chat_id: input.chatId,
    sender_id: input.senderId,
    body: input.body,
    image_path: null,
    created_at: at.toISOString(),
    local: 'sending',
  };
}

export function optimisticRoomMessage(input: {
  senderId: string;
  body: string;
  at?: Date;
}): RoomThreadMessage {
  const at = input.at ?? new Date();
  return {
    id: localId(at),
    sender_id: input.senderId,
    display_name: null,
    photo_path: null,
    body: input.body,
    image_path: null,
    removed: false,
    unsent_at: null,
    created_at: at.toISOString(),
    // Text only. A photo never takes this path — it has an upload to finish
    // before there is anything to show — so there is no state to be in.
    photo_state: 'none',
    local: 'sending',
  };
}

/** Newest first, which is the order an inverted list wants. */
export function withOptimistic<T extends { id: string }>(current: T[], optimistic: T): T[] {
  return [optimistic, ...current];
}

/**
 * Swap the placeholder for the row the server actually stored — and if the
 * real row already arrived over realtime first, just drop the placeholder
 * rather than showing the message twice.
 */
export function settleOptimistic<T extends { id: string }>(
  current: T[],
  localMessageId: string,
  real: T
): T[] {
  const withoutLocal = current.filter((message) => message.id !== localMessageId);
  return withoutLocal.some((message) => message.id === real.id)
    ? withoutLocal
    : [real, ...withoutLocal];
}

/**
 * Mark a placeholder as failed rather than deleting it.
 *
 * Deleting is what most apps do and it is the wrong call: the sentence the
 * person wrote disappears along with the failure, so there is nothing to
 * retry and nothing to copy out. It stays put, greyed, tappable.
 */
export function failOptimistic<T extends { id: string; local?: 'sending' | 'failed' }>(
  current: T[],
  localMessageId: string
): T[] {
  return current.map((message) =>
    message.id === localMessageId ? { ...message, local: 'failed' as const } : message
  );
}

export function dropOptimistic<T extends { id: string }>(
  current: T[],
  localMessageId: string
): T[] {
  return current.filter((message) => message.id !== localMessageId);
}

/**
 * Keep failed sends across a refetch.
 *
 * The thread query refetches on every mount and every realtime insert, and a
 * refetch replaces the array wholesale — so the greyed "Not sent" bubble, and
 * the sentence inside it, were deleted by the next message anybody else
 * posted, or simply by backing out and coming back. A row still IN FLIGHT can
 * be dropped safely, because settleOptimistic puts the real one back when the
 * send lands. A failed one is the only copy of what somebody wrote, and the
 * whole reason failOptimistic greys the bubble instead of deleting it.
 *
 * Newest first, matching withOptimistic: what you just tried to send belongs
 * at the near end of the thread, not buried in it.
 */
export function carryFailed<T extends { id: string; local?: 'sending' | 'failed' }>(
  previous: T[] | undefined,
  fetched: T[]
): T[] {
  const failed = (previous ?? []).filter((message) => message.local === 'failed');
  return failed.length === 0 ? fetched : [...failed, ...fetched];
}
