import type { PinCategory } from '@/lib/database.types';

/**
 * A plan attached to a message, as the thread draws it.
 *
 * `room_messages` joins these columns onto every row it returns and nulls all
 * of them together the moment the pin expires — hard rule 3 says an expired
 * pin is unreadable to everybody, its author included, and a chat must never
 * become the way around that. So this reader has exactly one job: decide
 * whether there is still a plan here. It never asks how long is left, because
 * by the time the answer would be "none" the columns are already empty.
 */
export type MessagePin = {
  messageId: string;
  pinId: string;
  venueName: string;
  /** What the person is doing there, in their own words. Often absent. */
  plan: string | null;
  category: PinCategory;
  /** ISO date, the way every trip date in this app travels. */
  intentDate: string;
};

/**
 * The shape a thread row has to have for a plan to be read off it.
 *
 * Every field is optional on purpose, which is what lets a direct chat's
 * `MessageRow` and a room's `RoomMessageRow` both be passed here without
 * either of them being widened: a direct chat reads the `messages` table and
 * carries none of the joined columns, so it simply has no plan to draw.
 */
export type PinCarrier = {
  id?: string;
  pin_id?: string | null;
  pin_venue_name?: string | null;
  pin_plan?: string | null;
  pin_category?: string | null;
  pin_intent_date?: string | null;
};

/**
 * The plan on this message, or null.
 *
 * Null in three cases and they are all the same answer on screen: the message
 * carries no pin, the pin has expired (the server has already nulled every
 * column), or the reader is only previewing a public room and was given the
 * message without the plan. Nothing is drawn half-built: the venue and the day
 * are both required, because a card that says "a plan" and names neither is
 * worse than no card.
 */
export function pinOnMessage(message: PinCarrier): MessagePin | null {
  const pinId = message.pin_id;
  const venueName = message.pin_venue_name;
  const intentDate = message.pin_intent_date;
  if (!message.id || !pinId || !venueName || !intentDate) {
    return null;
  }
  return {
    messageId: message.id,
    pinId,
    venueName,
    plan: message.pin_plan ?? null,
    category: (message.pin_category ?? 'other') as PinCategory,
    intentDate,
  };
}
