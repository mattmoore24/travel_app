import type { PostgrestError, RealtimeChannel } from '@supabase/supabase-js';

import { ROOM_MESSAGE_PAGE } from '@/features/chat/paging';
import type {
  PinnedMessageRow,
  CityRoomRow,
  PinForGroupRow,
  ReactionSummaryRow,
  RoomMessageRow,
} from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

/**
 * Who reacted to one message, and with what.
 *
 * Declared here rather than in src/lib/database.types.ts because that file is
 * owned by another implementer this session — see the report's "NEEDS WIRING"
 * section, which names the line it belongs on. The shape is
 * message_reactors()'s OUT columns exactly.
 */
export type ReactorRow = {
  user_id: string;
  display_name: string | null;
  photo_path: string | null;
  emoji: string;
};

/**
 * The two RPCs 20260902200000 adds are not in database.types.ts's Functions
 * map yet (same reason as above), and `supabase.rpc` will only accept a name
 * it finds there. This is the one narrow door, and it is a door rather than an
 * `any`: the argument object and the row type are still both checked at every
 * call below. Delete it the moment the Functions entries land.
 */
type UntypedRpc = <T>(
  name: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: T | null; error: PostgrestError | null }>;

const untypedRpc = supabase.rpc as unknown as UntypedRpc;

/**
 * Who reacted to one message.
 *
 * Rooms and groups only, and the SERVER is what decides that: a one-to-one
 * chat has exactly two people in it, so naming the reactor there would answer
 * "does the other person like what I said", which is a reciprocal-interest
 * reveal reached from the side. message_reactors() returns nothing at all for
 * a chat whose kind is not 'room', so a client that asked anyway would learn
 * nothing.
 */
export async function fetchReactors(messageId: string) {
  const { data, error } = await untypedRpc<ReactorRow[]>('message_reactors', {
    p_message_id: messageId,
  });
  if (error) {
    throw error;
  }
  return data ?? [];
}

/**
 * Join a plan somebody sent into the conversation: post your OWN pin at the
 * same venue, on the same day.
 *
 * Not join_pin_chat — that door belongs to the map, exists only for pins
 * posted in the "anyone can join" shape, and inside a group would usually lead
 * back to the room you are already standing in. A second pin is what puts a
 * plan agreed in a chat onto the map and into the heat. Tapping twice returns
 * the pin the first tap made rather than posting a second.
 */
export async function joinPlanFromMessage(messageId: string) {
  const { data, error } = await untypedRpc<string>('copy_plan_from_message', {
    p_message_id: messageId,
  });
  if (error) {
    throw error;
  }
  return data;
}

/** What a host has kept at the top of this room. */
export async function fetchRoomPins(chatId: string) {
  const { data, error } = await supabase.rpc('room_pins', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return (data ?? []) as PinnedMessageRow[];
}

export async function pinMessage(messageId: string, hours = 24) {
  const { error } = await supabase.rpc('pin_message', {
    p_message_id: messageId,
    p_hours: hours,
  });
  if (error) {
    throw error;
  }
}

export async function unpinMessage(messageId: string) {
  const { error } = await supabase.rpc('unpin_message', { p_message_id: messageId });
  if (error) {
    throw error;
  }
}

/**
 * What a room is called, for the header somebody sees before they join.
 *
 * my_chats() carries the name but only for members, which is exactly the
 * people who did not need it — a visitor reading a hostel's public preview
 * used to get the literal words "Guest room".
 */
export async function fetchRoomInfo(chatId: string) {
  const { data, error } = await supabase.rpc('room_info', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return (data ?? [])[0] ?? null;
}

/**
 * The plan a pin-born group came from, while the pin is alive. Definer and
 * member-gated server-side: a joiner is already in the room, so the pin
 * owner's discovery filter must not hide the plan from them. Null once the
 * pin has expired (hard rule 3: an expired pin is unreadable) or been taken
 * down — the room then says the plan has ended rather than showing a stale
 * clock.
 */
export async function fetchPinForGroup(chatId: string) {
  const { data, error } = await supabase.rpc('pin_for_group', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
  return ((data ?? []) as PinForGroupRow[])[0] ?? null;
}

/** Business rooms in a city. Readable signed-out. */
export async function fetchCityRooms(cityId: number) {
  const { data, error } = await supabase.rpc('city_rooms', { p_city_id: cityId });
  if (error) {
    throw error;
  }
  return (data ?? []) as CityRoomRow[];
}

/**
 * A room's messages, newest first. Members and moderators always; everyone
 * else only where the business left the public preview on — the server
 * decides, not us.
 *
 * `before` pages backwards through a busy room. The RPC has taken a limit
 * since it was written and this client never passed one, so a hostel room was
 * silently capped at sixty messages with no way back.
 */
export async function fetchRoomMessages(chatId: string, before?: string | null) {
  const { data, error } = await supabase.rpc('room_messages', {
    p_chat_id: chatId,
    p_limit: ROOM_MESSAGE_PAGE,
    p_before: before ?? null,
  });
  if (error) {
    throw error;
  }
  return (data ?? []) as RoomMessageRow[];
}

/**
 * Live inserts for one room.
 *
 * Its own channel topic, not the direct-chat one, so a room and a chat can
 * never end up sharing a subscription. The callback gets no payload on
 * purpose: room_messages is an RPC that joins the sender's name and photo, so
 * a raw messages row would render as a message from nobody. The caller
 * refetches instead.
 */
export function subscribeToRoomMessages(chatId: string, onChange: () => void): RealtimeChannel {
  return supabase
    .channel(`room-messages:${chatId}`)
    .on(
      // Updates as well as inserts. A photo lands as 'pending' and becomes
      // visible when the worker writes a verdict, which is an UPDATE — so
      // with INSERT alone the review tile sat there until somebody else
      // posted, and the screen most likely to be open while it cleared was
      // the one screen that could not notice. A room reads a joined RPC
      // rather than the table, so this refetches rather than patching.
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      () => onChange()
    )
    .subscribe();
}

/** Joining asks one question: when do you leave? That drives the expiry. */
export async function joinRoom(chatId: string, departureDate: string) {
  const { data, error } = await supabase.rpc('join_room', {
    p_chat_id: chatId,
    p_departure_date: departureDate,
  });
  if (error) {
    throw error;
  }
  return data as unknown as { joined: boolean; expires_at: string };
}

export async function leaveRoom(chatId: string) {
  const { error } = await supabase.rpc('leave_room', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
}

export async function setChatPref(
  chatId: string,
  pref: { pinned?: boolean; muted?: boolean; archived?: boolean }
) {
  const { error } = await supabase.rpc('set_chat_pref', {
    p_chat_id: chatId,
    p_pinned: pref.pinned ?? null,
    p_muted: pref.muted ?? null,
    p_archived: pref.archived ?? null,
  });
  if (error) {
    throw error;
  }
}

export async function fetchReactions(chatId: string) {
  const { data, error } = await supabase.rpc('message_reaction_summary', {
    p_chat_id: chatId,
  });
  if (error) {
    throw error;
  }
  return (data ?? []) as ReactionSummaryRow[];
}

/**
 * One reaction per person per message: picking a second emoji MOVES yours
 * rather than stacking. The move is a single statement server-side, because
 * PostgREST's own upsert rewrites every column in the payload and only
 * `emoji` may be updated.
 */
export async function setReaction(messageId: string, emoji: string) {
  const { error } = await supabase.rpc('set_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
  });
  if (error) {
    throw error;
  }
}

export async function removeReaction(messageId: string, userId: string) {
  const { error } = await supabase
    .from('message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId);
  if (error) {
    throw error;
  }
}

/**
 * Take a message back. The row survives with its content emptied and the
 * original archived, so a report filed against it stays reviewable — you
 * cannot send something abusive and then erase the evidence.
 */
export async function unsendMessage(messageId: string) {
  const { error } = await supabase.rpc('unsend_message', { p_message_id: messageId });
  if (error) {
    throw error;
  }
}

/** Moderator-only; the RPC re-checks staff membership server-side. */
export async function removeRoomMessage(messageId: string) {
  const { error } = await supabase.rpc('room_remove_message', { p_message_id: messageId });
  if (error) {
    throw error;
  }
}
