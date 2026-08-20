import type { RealtimeChannel } from '@supabase/supabase-js';

import type { MessageRow, ReportReason } from '@/lib/database.types';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
import { supabase } from '@/lib/supabase';

const MESSAGE_PAGE = 100;
export const CHAT_PHOTO_BUCKET = 'chat-photos';

export async function fetchMessages(chatId: string) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE);
  if (error) {
    throw error;
  }
  // Newest-first from the DB (for the inverted list).
  return (data ?? []) as MessageRow[];
}

export async function sendMessage(chatId: string, senderId: string, body: string) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, sender_id: senderId, body })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as MessageRow;
}

/**
 * Send a photo. The message row holds the storage path; with photo moderation
 * on it lands as 'pending' and nobody else can load the image until the
 * worker clears it — which is not optional in a publicly-readable room.
 */
export async function sendPhotoMessage(chatId: string, senderId: string, localUri: string) {
  const imagePath = await processAndUploadImage(CHAT_PHOTO_BUCKET, senderId, localUri);
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, sender_id: senderId, image_path: imagePath })
    .select()
    .single();
  if (error) {
    await removeUploadedImage(CHAT_PHOTO_BUCKET, imagePath);
    throw error;
  }
  return data as MessageRow;
}

/** Chat photos live in their own private bucket, served via signed URLs. */
export async function signedChatPhotoUrl(storagePath: string) {
  const { data, error } = await supabase.storage
    .from(CHAT_PHOTO_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error) {
    throw error;
  }
  return data.signedUrl;
}

/**
 * Live inserts for one chat. Postgres Changes are RLS-filtered server-side,
 * so a subscriber only ever receives rows they could select.
 */
export function subscribeToMessages(
  chatId: string,
  onMessage: (message: MessageRow) => void
): RealtimeChannel {
  return supabase
    .channel(`messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => onMessage(payload.new as MessageRow)
    )
    .subscribe();
}

export async function leaveChat(chatId: string) {
  const { error } = await supabase.rpc('unmatch_chat', { p_chat_id: chatId });
  if (error) {
    throw error;
  }
}

export async function blockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from('blocks')
    .insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) {
    throw error;
  }
}

export async function reportUser(input: {
  reporterId: string;
  reportedUserId: string;
  reason: ReportReason;
  details: string | null;
  context: string | null;
}) {
  const { error } = await supabase.from('reports').insert({
    reporter_id: input.reporterId,
    reported_user_id: input.reportedUserId,
    reason: input.reason,
    details: input.details,
    context: input.context,
  });
  if (error) {
    throw error;
  }
}
