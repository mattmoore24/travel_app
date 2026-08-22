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
    created_at: at.toISOString(),
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
