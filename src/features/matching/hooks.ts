import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchIncomingRequests,
  fetchMatches,
  fetchMyChats,
  fetchSentRequests,
  fetchSocialHandles,
  markChatRead,
  respondToRequest,
  sendMessageRequest,
} from '@/features/matching/api';
import { waitingTotal } from '@/features/chat/unread';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import type { RequestSource } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useMatches() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['matches', userId],
    queryFn: fetchMatches,
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSentRequests() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['sent-requests', userId],
    queryFn: fetchSentRequests,
    enabled: isSupabaseConfigured && userId != null,
  });
}

export function useSendRequest() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      recipientId: string;
      source: RequestSource;
      firstMessage: string;
      profileElement: string | null;
    }) =>
      sendMessageRequest(input.recipientId, input.source, input.firstMessage, input.profileElement),
    onSuccess: (result, input) => {
      analytics.capture('request_sent', {
        source: input.source,
        delivered: result.delivered,
        blocked: result.blocked,
      });
      queryClient.invalidateQueries({ queryKey: ['sent-requests', userId] });
    },
  });
}

export function useIncomingRequests() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['incoming-requests', userId],
    queryFn: fetchIncomingRequests,
    enabled: isSupabaseConfigured && userId != null,
  });
}

/** What the Chat tab's badge counts (see features/chat/unread.ts). */
export function useWaitingCount() {
  const { data: chats = [] } = useMyChats();
  const { data: requests = [] } = useIncomingRequests();
  return waitingTotal(chats, requests.length);
}

export function useRespondToRequest() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { requestId: string; accept: boolean }) =>
      respondToRequest(input.requestId, input.accept),
    onSuccess: (result) => {
      analytics.capture('request_responded', { accepted: result.accepted });
      queryClient.invalidateQueries({ queryKey: ['incoming-requests', userId] });
      if (result.accepted) {
        queryClient.invalidateQueries({ queryKey: ['chats', userId] });
        // Accepting is exactly what unlocks their handles and makes their
        // profile readable to us — refetch both instead of waiting out the
        // 30s staleTime with a profile that still says "shared once you
        // two are chatting".
        queryClient.invalidateQueries({ queryKey: ['unlocked-socials'] });
        queryClient.invalidateQueries({ queryKey: ['public-profile'] });
      }
    },
  });
}

export function useMyChats(archived = false) {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['chats', userId, String(archived)],
    queryFn: () => fetchMyChats(archived),
    enabled: isSupabaseConfigured && userId != null,
  });
}

/**
 * Mark a chat read, and refresh the list so the dot and the tab badge clear.
 *
 * Deliberately silent on failure: this is bookkeeping, and a person who has
 * just opened a conversation should never be shown an error about it. The
 * next mount tries again.
 */
export function useMarkChatRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => markChatRead(chatId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
    onError: () => {},
  });
}

/** Another user's handles — RLS only returns rows once an accepted chat exists. */
export function useUnlockedSocialHandles(userId: string | null) {
  return useQuery({
    queryKey: ['unlocked-socials', userId],
    queryFn: () => fetchSocialHandles(userId!),
    enabled: isSupabaseConfigured && userId != null,
  });
}
