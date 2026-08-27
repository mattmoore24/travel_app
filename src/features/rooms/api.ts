import type { RealtimeChannel } from '@supabase/supabase-js';

import type {
  PinnedMessageRow,
  CityRoomRow,
  ReactionSummaryRow,
  RoomMessageRow,
} from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

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

/** Business rooms in a city. Readable signed-out. */
export async function fetchCityRooms(cityId: number) {
  const { data, error } = await supabase.rpc('city_rooms', { p_city_id: cityId });
  if (error) {
    throw error;
  }
  return (data ?? []) as CityRoomRow[];
}

/**
 * A room's messages. Members and moderators always; everyone else only where
 * the business left the public preview on — the server decides, not us.
 */
export async function fetchRoomMessages(chatId: string) {
  const { data, error } = await supabase.rpc('room_messages', { p_chat_id: chatId });
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
export function subscribeToRoomMessages(chatId: string, onInsert: () => void): RealtimeChannel {
  return supabase
    .channel(`room-messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      () => onInsert()
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
