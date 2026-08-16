import type {
  ChatListRow,
  IncomingRequestRow,
  MatchRow,
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
  firstMessage: string,
  profileElement: string | null
) {
  const { data, error } = await supabase.rpc('send_message_request', {
    p_recipient: recipientId,
    p_source: 'trip_match',
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

export async function fetchSentRequests() {
  const { data, error } = await supabase.rpc('sent_requests');
  if (error) {
    throw error;
  }
  return (data ?? []) as SentRequestRow[];
}

export async function fetchMyChats() {
  const { data, error } = await supabase.rpc('my_chats');
  if (error) {
    throw error;
  }
  return (data ?? []) as ChatListRow[];
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
