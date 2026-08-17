import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  blockUser,
  fetchMessages,
  reportUser,
  sendMessage,
  sendPhotoMessage,
  signedChatPhotoUrl,
  subscribeToMessages,
  unmatchChat,
} from '@/features/chat/api';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import type { MessageRow, ReportReason } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

/** Initial page + live inserts, newest first (for an inverted list). */
export function useMessages(chatId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['messages', chatId],
    queryFn: () => fetchMessages(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    // The subscription only covers inserts while THIS screen is mounted —
    // always refetch on mount/focus so messages that arrived while away (or
    // during the fetch-to-subscribe gap) are never silently missing.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (!isSupabaseConfigured || chatId == null) {
      return;
    }
    const channel = subscribeToMessages(chatId, (message) => {
      queryClient.setQueryData<MessageRow[]>(['messages', chatId], (current = []) =>
        current.some((m) => m.id === message.id) ? current : [message, ...current]
      );
    });
    return () => {
      channel.unsubscribe();
    };
  }, [chatId, queryClient]);

  return query;
}

export function useSendMessage(chatId: string | null) {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => sendMessage(chatId!, userId!, body),
    onSuccess: (message) => {
      analytics.capture('message_sent', { chat_id: message.chat_id });
      // Realtime doesn't echo our own insert reliably before the ack; merge it.
      queryClient.setQueryData<MessageRow[]>(['messages', chatId], (current = []) =>
        current.some((m) => m.id === message.id) ? current : [message, ...current]
      );
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
    },
  });
}

/** Send a photo into a chat or room. */
export function useSendPhoto(chatId: string) {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (localUri: string) => sendPhotoMessage(chatId, userId!, localUri),
    onSuccess: () => {
      analytics.capture('message_sent', { kind: 'photo' });
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useUnmatch() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => unmatchChat(chatId),
    onSuccess: () => {
      analytics.capture('unmatched');
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
      queryClient.invalidateQueries({ queryKey: ['sent-requests', userId] });
    },
  });
}

export function useBlockUser() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (blockedId: string) => blockUser(userId!, blockedId),
    onSuccess: () => {
      analytics.capture('user_blocked');
      // A block reshapes everything: matches, pins, chats, requests.
      queryClient.invalidateQueries();
    },
  });
}

export function useReportUser() {
  const userId = useOwnUserId();
  return useMutation({
    mutationFn: (input: {
      reportedUserId: string;
      reason: ReportReason;
      details: string | null;
      context: string | null;
    }) => reportUser({ reporterId: userId!, ...input }),
    onSuccess: () => {
      analytics.capture('user_reported');
    },
  });
}

/** Signed URL for a chat photo (cached just under its TTL, like profile photos). */
export function useChatPhotoUrl(storagePath: string | null) {
  return useQuery({
    queryKey: ['chat-photo-url', storagePath],
    queryFn: () => signedChatPhotoUrl(storagePath!),
    enabled: isSupabaseConfigured && storagePath != null,
    staleTime: 50 * 60 * 1000,
    gcTime: 55 * 60 * 1000,
  });
}
