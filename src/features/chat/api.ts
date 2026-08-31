import type { RealtimeChannel } from '@supabase/supabase-js';

import { MESSAGE_PAGE } from '@/features/chat/paging';
import type { MessageRow, ReportReason } from '@/lib/database.types';
import { processAndUploadImage, removeUploadedImage } from '@/lib/image-upload';
import { supabase } from '@/lib/supabase';

export const CHAT_PHOTO_BUCKET = 'chat-photos';

/**
 * One page of a conversation, newest first.
 *
 * `before` is the oldest `created_at` already on screen: the thread pages
 * BACKWARDS, because a conversation that stopped at a hundred messages simply
 * ended, with no spinner and nothing to say a limit had been applied.
 */
export async function fetchMessages(chatId: string, before?: string | null) {
  const rows = supabase.from('messages').select('*').eq('chat_id', chatId);
  const page = before ? rows.lt('created_at', before) : rows;
  const { data, error } = await page.order('created_at', { ascending: false }).limit(MESSAGE_PAGE);
  if (error) {
    throw error;
  }
  // Newest-first from the DB (for the inverted list).
  return (data ?? []) as MessageRow[];
}

/**
 * `replyToMessageId` is the message this one answers, or null for an ordinary
 * one. The database refuses a parent from another chat outright
 * (messages_reply_same_chat), so this is a door rather than a lock.
 */
export async function sendMessage(
  chatId: string,
  senderId: string,
  body: string,
  replyToMessageId?: string | null
) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      sender_id: senderId,
      body,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data as MessageRow;
}

/**
 * Send a photo, and the words that came with it, as ONE message.
 *
 * They used to be two inserts, and the order they landed in was the opposite
 * of the order they were written: the photo waits for a moderation verdict
 * and the caption does not, so a picture with "look at this" under it
 * delivered the caption first and the photo some seconds later, under it,
 * reading as a non-sequitur followed by an unexplained image. One row also
 * means one thing to unsend, one thing to react to, and one bubble.
 *
 * With photo moderation on the row lands as 'pending' and nobody but the
 * sender can load the image until the worker clears it — which is not
 * optional in a publicly-readable room.
 */
export async function sendPhotoMessage(
  chatId: string,
  senderId: string,
  localUri: string,
  body?: string,
  replyToMessageId?: string | null
) {
  const imagePath = await processAndUploadImage(CHAT_PHOTO_BUCKET, senderId, localUri);
  const caption = (body ?? '').trim();
  const { data, error } = await supabase
    .from('messages')
    .insert({
      chat_id: chatId,
      sender_id: senderId,
      image_path: imagePath,
      // Omitted rather than sent as null when there is no caption: the column
      // defaults to null anyway, and `messages_have_content` is satisfied by
      // the image either way.
      ...(caption.length > 0 ? { body: caption } : {}),
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    })
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
 * Live inserts AND updates for one chat. Postgres Changes are RLS-filtered
 * server-side, so a subscriber only ever receives rows they could select.
 *
 * The update half is not decoration. A photo lands as 'pending' and becomes
 * visible when the worker writes a verdict — an UPDATE, never an insert — so
 * with INSERT alone the review tile sat there until something else happened
 * in the conversation or the person backed out and came back in. The one
 * screen most likely to be open while it clears was the one screen that could
 * not notice.
 */
export function subscribeToMessages(
  chatId: string,
  onMessage: (message: MessageRow) => void
): RealtimeChannel {
  return supabase
    .channel(`messages:${chatId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
      (payload) => {
        const row = payload.new as MessageRow | Record<string, never>;
        if (row && 'id' in row) {
          onMessage(row as MessageRow);
        }
      }
    )
    .subscribe();
}

/**
 * Live inserts across every chat this user can see — the chat LIST's nervous
 * system, as opposed to one open thread's.
 *
 * No chat_id filter, and that is safe rather than sloppy: Postgres Changes
 * are RLS-filtered server-side, so this only ever delivers rows the caller
 * could have selected, which for `messages` means chats they are actually in.
 */
export function subscribeToMyMessages(onInsert: () => void): RealtimeChannel {
  return supabase
    .channel('messages:mine')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () =>
      onInsert()
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

/**
 * File a report about a person, a chat, or both.
 *
 * A report needs a subject and does not need a PERSON: when the problem is
 * the room itself rather than one person in it, naming somebody would be a
 * guess. The database enforces both halves — `reports_has_a_subject` refuses
 * a report with neither, and the insert policy refuses a chat report from
 * somebody who is not in that chat, so this cannot become a way to probe
 * chats you have never been in.
 */
export async function reportUser(input: {
  reporterId: string;
  reportedUserId?: string | null;
  reportedChatId?: string | null;
  reason: ReportReason;
  details: string | null;
  context: string | null;
}) {
  const { error } = await supabase.from('reports').insert({
    reporter_id: input.reporterId,
    reported_user_id: input.reportedUserId ?? null,
    reported_chat_id: input.reportedChatId ?? null,
    reason: input.reason,
    details: input.details,
    context: input.context,
  });
  if (error) {
    throw error;
  }
}
