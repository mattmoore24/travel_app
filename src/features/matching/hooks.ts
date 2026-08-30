import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import {
  fetchIncomingRequests,
  fetchMatches,
  fetchDailySpotlight,
  fetchFirstMessageBudget,
  fetchMyChats,
  fetchSentRequests,
  fetchSocialHandles,
  markChatRead,
  previewFirstMessage,
  respondToRequest,
  sendMessageRequest,
} from '@/features/matching/api';
import { useIsBusiness } from '@/features/business/hooks';
import { waitingTotal } from '@/features/chat/unread';
import { usePushPrimer } from '@/features/notifications/primer-store';
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
  // Never for a business. A hello is a traveler asking a traveler, and
  // message_requests_refuse_business refuses one from this account either
  // way, so this was two round trips per focus that could not come back with
  // a row. While the account kind is still settling the answer is "not a
  // business", so a traveler's list is never held up waiting for it.
  const isBusiness = useIsBusiness();
  return useQuery({
    queryKey: ['sent-requests', userId],
    queryFn: fetchSentRequests,
    enabled: isSupabaseConfigured && userId != null && !isBusiness,
  });
}

/**
 * Today's spotlight. One fetch per day per device is plenty: the pairing
 * cannot change once it is written, so a long staleTime keeps a tab switch
 * from re-asking a volatile RPC.
 */
export function useDailySpotlight() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['daily-spotlight', userId],
    queryFn: fetchDailySpotlight,
    enabled: isSupabaseConfigured && userId != null,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    retry: false,
  });
}

/**
 * Today's hello budget. Read by the composer so a person can see the limit
 * coming rather than discovering it by being refused.
 */
export function useFirstMessageBudget() {
  const userId = useOwnUserId();
  return useQuery({
    queryKey: ['first-message-budget', userId],
    queryFn: fetchFirstMessageBudget,
    enabled: isSupabaseConfigured && userId != null,
    staleTime: 0,
  });
}

/**
 * Ask, quietly, whether a draft is going to be stopped.
 *
 * Debounced and fire-and-forget: this is a nudge, not a gate. The send path
 * still runs the same check server-side, and this only exists so most
 * would-be rejections turn into a reword before anybody presses send.
 */
export function useDraftWarning(draft: string, enabled: boolean) {
  // What was FLAGGED, not whether something is. Storing the text itself is
  // what lets the warning be derived during render: editing a character
  // clears it immediately, and nothing has to be reset in an effect.
  const [flagged, setFlagged] = useState<string | null>(null);
  const text = draft.trim();
  const checkable = enabled && isSupabaseConfigured && text.length >= DRAFT_CHECK_MIN;

  useEffect(() => {
    if (!checkable) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      previewFirstMessage(text).then((wouldBlock) => {
        if (active && wouldBlock) {
          setFlagged(text);
        }
      });
    }, DRAFT_CHECK_DEBOUNCE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [text, checkable]);

  return checkable && flagged === text;
}

/** Short enough that nobody is warned about "hi". */
const DRAFT_CHECK_MIN = 12;
const DRAFT_CHECK_DEBOUNCE_MS = 700;

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
        // Without this the §6 funnel goes blind the moment moderation holds
        // a hello: queued is the delivered of the moderated path.
        queued: result.queued,
        blocked: result.blocked,
      });
      queryClient.invalidateQueries({ queryKey: ['sent-requests', userId] });
      queryClient.invalidateQueries({ queryKey: ['first-message-budget', userId] });
      // The first moment there is an answer worth waiting for. The primer
      // decides for itself whether there is anything left to ask. `queued`
      // counts: with require_llm_moderation on, EVERY hello is queued rather
      // than delivered, and gating on delivered alone silently switched the
      // ask off on the one flow it was built for.
      if (result.delivered || result.queued) {
        usePushPrimer.getState().ask('hello-sent');
      }
    },
  });
}

export function useIncomingRequests() {
  const userId = useOwnUserId();
  // Same reason as the sent side: nobody says hi to a business. A traveler
  // who wants one writes through message_business, which opens a
  // conversation rather than a request.
  const isBusiness = useIsBusiness();
  return useQuery({
    queryKey: ['incoming-requests', userId],
    queryFn: fetchIncomingRequests,
    enabled: isSupabaseConfigured && userId != null && !isBusiness,
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
