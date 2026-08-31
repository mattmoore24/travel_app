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

export async function fetchSentRequests() {
  const { data, error } = await supabase.rpc('sent_requests');
  if (error) {
    throw error;
  }
  return (data ?? []) as SentRequestRow[];
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
