import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  blockUser,
  fetchMessages,
  reportUser,
  sendMessage,
  sendPhotoMessage,
  signedChatPhotoUrl,
  subscribeToMessages,
  subscribeToMyMessages,
  leaveChat,
} from '@/features/chat/api';
import {
  carryFailed,
  dropOptimistic,
  failOptimistic,
  optimisticMessage,
  optimisticRoomMessage,
  settleOptimistic,
  withOptimistic,
  type ThreadMessage,
} from '@/features/chat/outgoing';
import {
  MESSAGE_PAGE,
  mapEveryPage,
  mapFirstPage,
  nextBefore,
  pagesHave,
  type ThreadPages,
} from '@/features/chat/paging';
import { captureMessageSent } from '@/features/chat/analytics';
import { useOwnUserId } from '@/features/profile/hooks';
import { analytics } from '@/lib/analytics';
import type { MessageRow, ReportReason } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * The conversation, newest first (for an inverted list), a page at a time,
 * plus live inserts and updates.
 *
 * Paged rather than capped: a chat that hit the limit simply ENDED, with no
 * spinner and no sign that anything had been left behind — and the anchor
 * note above it went on describing what the conversation started from while
 * standing above message one hundred.
 */
export function useMessages(chatId: string | null) {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ['messages', chatId],
    queryFn: async ({ pageParam }) => {
      const page = await fetchMessages(chatId!, pageParam);
      // Failed sends survive a refetch, and only on the newest page: that is
      // where a bubble somebody just wrote belongs, and an older page has
      // nothing to carry.
      return pageParam == null
        ? carryFailed<ThreadMessage>(
            queryClient.getQueryData<ThreadPages<ThreadMessage>>(['messages', chatId])?.pages[0],
            page
          )
        : page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ThreadMessage[]) => nextBefore(lastPage, MESSAGE_PAGE),
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
      queryClient.setQueryData<ThreadPages<MessageRow>>(['messages', chatId], (current) =>
        // Replace, not skip. The same row arrives again when a verdict lands
        // on a photo — that is the event that turns the review tile into a
        // picture — and treating a known id as nothing to do meant the tile
        // stayed up on the screen that was watching it. Across EVERY page,
        // because by the time a verdict lands the message may have been
        // pushed back a page by the conversation.
        pagesHave(current, message.id)
          ? mapEveryPage(current, (rows) =>
              rows.map((m) => (m.id === message.id ? { ...m, ...message } : m))
            )
          : mapFirstPage(current, (rows) => [message, ...rows])
      );
    });
    return () => {
      channel.unsubscribe();
    };
  }, [chatId, queryClient]);

  return query;
}

/**
 * Keeps the chat LIST live while you are looking at it: a message landing in
 * any conversation refreshes the rows, so the dot, the preview and the tab
 * badge appear without a pull-to-refresh.
 *
 * Trailing-debounced, because a busy hostel room can insert a dozen rows in a
 * second and each one would otherwise be its own round trip for a list that
 * only needs to be right once the burst is over.
 */
export function useLiveChatList() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = subscribeToMyMessages(() => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        queryClient.invalidateQueries({ queryKey: ['chats'] });
      }, LIST_REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (timer) {
        clearTimeout(timer);
      }
      channel.unsubscribe();
    };
  }, [queryClient]);
}

const LIST_REFRESH_DEBOUNCE_MS = 600;

/**
 * Send a message, and put it on screen before the server has heard of it.
 *
 * The bubble appears the instant you hit send, greyed and marked "Sending",
 * and settles into an ordinary one when the row comes back. That is not only
 * polish: the FIRST message between two people goes through moderation, so a
 * pause is the normal case here, and without a placeholder the composer looks
 * like it swallowed the sentence. A send that fails leaves the bubble in
 * place, greyed, tappable — deleting it would take the person's words with
 * it and leave nothing to retry.
 *
 * `kind` exists because rooms read a different cache key AND a different row
 * shape (room_messages joins the sender), so the placeholder has to be built
 * to match whichever thread is on screen.
 */
export type OutgoingMessage = {
  body: string;
  /**
   * The message this one answers, with enough of it to draw the quoted strip
   * on the placeholder. Absent for an ordinary send.
   */
  replyTo?: { messageId: string; name: string; body: string | null } | null;
};

export function useSendMessage(chatId: string | null, kind: 'direct' | 'room' = 'direct') {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  const key = kind === 'room' ? ['room-messages', chatId] : ['messages', chatId];

  return useMutation({
    mutationFn: (input: OutgoingMessage) =>
      sendMessage(chatId!, userId!, input.body, input.replyTo?.messageId ?? null),
    meta: { failureTitle: "Couldn't send that" },

    onMutate: (input: OutgoingMessage) => {
      if (chatId == null || userId == null) {
        return undefined;
      }
      const { body, replyTo } = input;
      const optimistic =
        kind === 'room'
          ? optimisticRoomMessage({
              senderId: userId,
              body,
              replyToMessageId: replyTo?.messageId ?? null,
              // The placeholder carries the quoted line itself, because the
              // room's real rows get it from the RPC and there is no row yet.
              replyToName: replyTo?.name ?? null,
              replyToBody: replyTo?.body ?? null,
            })
          : optimisticMessage({
              chatId,
              senderId: userId,
              body,
              replyToMessageId: replyTo?.messageId ?? null,
            });
      // The newest page, which is where the newest message goes. mapFirstPage
      // seeds an empty cache rather than skipping it, so the bubble appears
      // even when the send beats the thread's first fetch.
      queryClient.setQueryData<ThreadPages<{ id: string }>>(key, (current) =>
        mapFirstPage(current, (rows) => withOptimistic(rows, optimistic))
      );
      return { localMessageId: optimistic.id };
    },

    onSuccess: (message, _input, context) => {
      captureMessageSent(message.chat_id, 'text', kind);
      if (context?.localMessageId == null) {
        return;
      }
      if (kind === 'room') {
        // Refetch and let the new array replace the placeholder, rather than
        // deleting it here. room_messages is a joined view this client cannot
        // synthesise, so there is no row to swap in — and dropping the
        // placeholder before the refetch lands leaves a window with neither,
        // where the message the person just sent blinks out of the thread.
        queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
      } else {
        queryClient.setQueryData<ThreadPages<ThreadMessage>>(key, (current) =>
          mapFirstPage(current, (rows) => settleOptimistic(rows, context.localMessageId, message))
        );
      }
      queryClient.invalidateQueries({ queryKey: ['chats', userId] });
    },

    onError: (_error, _input, context) => {
      if (context?.localMessageId == null) {
        return;
      }
      queryClient.setQueryData<ThreadPages<ThreadMessage>>(key, (current) =>
        mapEveryPage(current, (rows) => failOptimistic(rows, context.localMessageId))
      );
    },
  });
}

/**
 * Take a failed message out of the thread — for a retry, which re-sends the
 * same words as a fresh optimistic bubble.
 */
export function useDiscardFailed(chatId: string | null, kind: 'direct' | 'room' = 'direct') {
  const queryClient = useQueryClient();
  const key = kind === 'room' ? ['room-messages', chatId] : ['messages', chatId];
  return (localMessageId: string) => {
    queryClient.setQueryData<ThreadPages<{ id: string }>>(key, (current) =>
      mapEveryPage(current, (rows) => dropOptimistic(rows, localMessageId))
    );
  };
}

/**
 * Send a photo into a chat or room, with whatever was typed under it.
 *
 * One message, not two. The caption used to be a second insert and it
 * OVERTOOK the photo, because text is delivered immediately and a photo waits
 * for a verdict — so "look at this" arrived first and the picture some seconds
 * later, underneath it.
 */
export function useSendPhoto(chatId: string, kind: 'direct' | 'room' = 'direct') {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      localUri,
      body,
      replyToMessageId,
    }: {
      localUri: string;
      body?: string;
      replyToMessageId?: string | null;
    }) => sendPhotoMessage(chatId, userId!, localUri, body, replyToMessageId),
    meta: { failureTitle: "Couldn't send that" },
    onSuccess: () => {
      captureMessageSent(chatId, 'photo', kind);
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useLeaveChat() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => leaveChat(chatId),
    meta: { failureTitle: 'Could not leave' },
    onSuccess: () => {
      analytics.capture('left_chat');
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
    meta: { failureTitle: 'Could not block them' },
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
      /** Absent when the subject is a chat rather than a person. */
      reportedUserId?: string | null;
      reportedChatId?: string | null;
      reason: ReportReason;
      details: string | null;
      context: string | null;
    }) => reportUser({ reporterId: userId!, ...input }),
    meta: { failureTitle: 'Could not send that report' },
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
