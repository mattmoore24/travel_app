import type { PostgrestError } from '@supabase/supabase-js';

import type {
  ChatListRow,
  IncomingRequestRow,
  MatchRow,
  RequestSource,
  SendRequestResult,
  SentRequestRow,
} from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export async function fetchMatches() {
  const { data, error } = await supabase.rpc('get_matches');
  if (error) {
    throw error;
  }
  return (data ?? []) as MatchRow[];
}

export async function sendMessageRequest(
  recipientId: string,
  source: RequestSource,
  firstMessage: string,
  profileElement: string | null
) {
  const { data, error } = await supabase.rpc('send_message_request', {
    p_recipient: recipientId,
    p_source: source,
    p_first_message: firstMessage,
    p_profile_element: profileElement,
  });
  if (error) {
    throw error;
  }
  return data as unknown as SendRequestResult;
}

export async function fetchIncomingRequests() {
  const { data, error } = await supabase.rpc('incoming_requests');
  if (error) {
    throw error;
  }
  return (data ?? []) as IncomingRequestRow[];
}

export async function respondToRequest(requestId: string, accept: boolean) {
  const { data, error } = await supabase.rpc('respond_to_message_request', {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) {
    throw error;
  }
  return data as unknown as { accepted: boolean; chat_id?: string };
}

/**
 * Would this draft be stopped, and which kind of wrong is it? Read-only, so
 * the composer can offer a reword while the sentence is still being written
 * rather than after it was sent.
 *
 * Returns wouldBlock false on any failure. A network blip must never turn
 * into a warning about somebody's perfectly ordinary message.
 */
export async function previewFirstMessage(
  text: string
): Promise<{ wouldBlock: boolean; category: string | null }> {
  const { data, error } = await supabase.rpc('preview_first_message', { p_text: text });
  if (error) {
    return { wouldBlock: false, category: null };
  }
  const row = (data ?? [])[0];
  return { wouldBlock: row?.would_block === true, category: row?.category ?? null };
}

/**
 * Today's spotlight — the one traveler surfaced to both of you.
 *
 * The RPC creates the pairing on first read, so the FIRST of the two to open
 * the tab is what fixes it for the day; the other inherits the same answer.
 * Null when there is nobody left to pair with, which is an ordinary outcome
 * rather than an error.
 */
export async function fetchDailySpotlight() {
  const { data, error } = await supabase.rpc('daily_spotlight');
  if (error) {
    throw error;
  }
  return (data ?? [])[0] ?? null;
}

/** How many hellos you have sent today, and how many you get. */
export async function fetchFirstMessageBudget() {
  const { data, error } = await supabase.rpc('first_message_budget');
  if (error) {
    throw error;
  }
  const row = (data ?? [])[0];
  return { used: row?.used ?? 0, allowed: row?.allowed ?? 8 };
}

/**
 * A hello you sent, plus the one fact 20260902210000 added to it.
 *
 * Declared here rather than widening SentRequestRow in
 * src/lib/database.types.ts because that file is owned by another implementer
 * this session - the report's "NEEDS WIRING" section names the line it
 * belongs on. sent_requests() already returns the column, so this widening is
 * a description of what arrives rather than a hope.
 *
 * `withdrawn_at` and not a fourth `state`: an over-the-air update is never
 * applied on the launch that downloads it, so for at least one launch every
 * phone runs the PREVIOUS bundle against the new schema, and a state it has
 * never heard of drops the sender's own hello out of "You said hi" (see
 * SentRequestRow's own note in database.types).
 */
export type SentRequest = SentRequestRow & { withdrawn_at: string | null };

export async function fetchSentRequests() {
  const { data, error } = await supabase.rpc('sent_requests');
  if (error) {
    throw error;
  }
  return (data ?? []) as SentRequest[];
}

/**
 * withdraw_message_request is not in database.types.ts's Functions map yet
 * (same reason as SentRequest above), and `supabase.rpc` only accepts a name
 * it finds there. One narrow door, and a door rather than an `any`: the
 * argument object and the answer are both still typed at the call below.
 * Delete it the moment the Functions entry lands - features/rooms/api.ts
 * carries the same door for the same reason.
 */
type UntypedRpc = <T>(
  name: string,
  args: Record<string, unknown>
) => PromiseLike<{ data: T | null; error: PostgrestError | null }>;

const untypedRpc = supabase.rpc as unknown as UntypedRpc;

/**
 * Take back a hello you sent.
 *
 * The row is NOT deleted. `unique (sender_id, recipient_id)` is one shot per
 * direction, ever - the anti-pester constraint - and deleting frees that
 * slot, so a delete would turn "take it back" into unlimited re-sends at the
 * person who did not answer. The server stamps `withdrawn_at` instead.
 *
 * `withdrawn: false` is an ordinary answer and never an error: the row was
 * already taken back, or was already accepted, or was never the caller's. It
 * is deliberately the SAME answer for all three, because a refusal that said
 * which would tell a sender what the recipient did - the one thing
 * sent_requests() exists to never say (invariant 4).
 */
export async function withdrawMessageRequest(requestId: string) {
  const { data, error } = await untypedRpc<{ withdrawn: boolean }>('withdraw_message_request', {
    p_request_id: requestId,
  });
  if (error) {
    throw error;
  }
  return data?.withdrawn === true;
}

/**
 * Say that this account opened the app today.
 *
 * A DATE and nothing else - no time, no city, no coordinates. It is what
 * makes admin_liquidity's `liquidity_reachable` countable: a trip can be
 * posted weeks ahead and run for weeks, so without this the number gating a
 * second city counts people who installed once and never came back. Kept to a
 * day on purpose: a per-minute last-seen is a presence signal, and presence is
 * one step from the live-location promise the product refuses (hard rule 2).
 *
 * Never surfaced to another user; no client can even read the column.
 */
export async function touchLastSeen() {
  const { error } = await untypedRpc<null>('touch_last_seen', {});
  if (error) {
    throw error;
  }
}

export async function fetchMyChats(archived = false) {
  const { data, error } = await supabase.rpc('my_chats', { p_archived: archived });
  if (error) {
    throw error;
  }
  return (data ?? []) as ChatListRow[];
}

/**
 * Say that this user has now seen everything in this chat. Idempotent, and
 * the mark never moves backwards, so calling it twice (mount, then a message
 * arriving) is free.
 */
export async function markChatRead(chatId: string) {
  const { error } = await supabase.rpc('mark_chat_read', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
}

export async function fetchSocialHandles(userId: string) {
  const { data, error } = await supabase
    .from('social_handles')
    .select('*')
    .eq('user_id', userId)
    .order('platform');
  if (error) {
    throw error;
  }
  return data;
}
