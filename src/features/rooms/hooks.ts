import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { carryFailed, type RoomThreadMessage, type ThreadMessage } from '@/features/chat/outgoing';
import { useOwnUserId } from '@/features/profile/hooks';
import {
  setReaction,
  fetchCityRooms,
  fetchReactions,
  fetchRoomMessages,
  joinRoom,
  leaveRoom,
  removeReaction,
  unsendMessage,
  removeRoomMessage,
  setChatPref,
  fetchPinForGroup,
  fetchRoomInfo,
  fetchRoomPins,
  pinMessage,
  unpinMessage,
  subscribeToRoomMessages,
} from '@/features/rooms/api';
import { applyToggle } from '@/features/rooms/reactions';
import { analytics } from '@/lib/analytics';
import type { ReactionSummaryRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useCityRooms(cityId: number | null) {
  return useQuery({
    queryKey: ['city-rooms', cityId],
    queryFn: () => fetchCityRooms(cityId!),
    enabled: isSupabaseConfigured && cityId != null,
  });
}

/** What this room is called, whether or not you are in it. */
export function useRoomInfo(chatId: string | null) {
  return useQuery({
    queryKey: ['room-info', chatId],
    queryFn: () => fetchRoomInfo(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The plan a pin-born group opened from. Pass null unless the group row
 * carries a non-null pin_id — the answer is a round trip, and a group made
 * any other way has nothing to ask about.
 */
export function usePinForGroup(chatId: string | null) {
  return useQuery({
    queryKey: ['pin-for-group', chatId],
    queryFn: () => fetchPinForGroup(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
  });
}

/** What a host has kept at the top of this room. */
export function useRoomPins(chatId: string | null) {
  return useQuery({
    queryKey: ['room-pins', chatId],
    queryFn: () => fetchRoomPins(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
  });
}

export function usePinMessage(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; hours?: number }) =>
      pinMessage(input.messageId, input.hours),
    meta: { failureTitle: 'Could not pin that' },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-pins', chatId] });
    },
  });
}

export function useUnpinMessage(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => unpinMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-pins', chatId] });
    },
  });
}

export function useRoomMessages(chatId: string | null) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['room-messages', chatId],
    // Failed sends survive the refetch. A room refetches on every realtime
    // insert, so without this the next thing anybody else posted deleted the
    // greyed "Not sent" bubble and the sentence inside it.
    queryFn: async () =>
      carryFailed<RoomThreadMessage>(
        queryClient.getQueryData<RoomThreadMessage[]>(['room-messages', chatId]),
        await fetchRoomMessages(chatId!)
      ),
    enabled: isSupabaseConfigured && chatId != null,
    // Same reasoning as direct chats: realtime can land between renders, so
    // never serve a stale first paint.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Rooms and groups had no subscription at all: two people in the same
  // hostel chat, both with the screen open, never saw each other's messages
  // for as long as they stayed on it.
  useEffect(() => {
    if (!isSupabaseConfigured || chatId == null) {
      return;
    }
    const channel = subscribeToRoomMessages(chatId, () => {
      queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
    });
    return () => {
      channel.unsubscribe();
    };
  }, [chatId, queryClient]);

  return query;
}

export function useJoinRoom(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (departureDate: string) => joinRoom(chatId, departureDate),
    onSuccess: () => {
      analytics.capture('room_joined', { chat_id: chatId });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
    },
  });
}

export function useLeaveRoom(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveRoom(chatId),
    onSuccess: () => {
      analytics.capture('room_left', { chat_id: chatId });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useChatPref() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      ...pref
    }: {
      chatId: string;
      pinned?: boolean;
      muted?: boolean;
      archived?: boolean;
    }) => setChatPref(chatId, pref),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useReactions(chatId: string | null) {
  return useQuery({
    queryKey: ['reactions', chatId],
    queryFn: () => fetchReactions(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    staleTime: 0,
  });
}

/**
 * `on: false` takes your reaction back; `on: true` sets it, replacing
 * whichever emoji you had on that message before. Nobody stacks six.
 *
 * Optimistic, the way useSendMessage already is: the chip lands the instant
 * the emoji is picked, not after set_reaction AND the summary refetch have
 * crossed hostel wifi. Nothing here fights realtime — no channel writes the
 * ['reactions', chatId] cache; it only ever changes by fetch or by this
 * setQueryData, and both use fetchReactions' row shape.
 */
export function useToggleReaction(chatId: string) {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji, on }: { messageId: string; emoji: string; on: boolean }) =>
      on ? setReaction(messageId, emoji) : removeReaction(messageId, userId!),
    onMutate: async ({ messageId, emoji, on }) => {
      // Stop an in-flight refetch (staleTime is 0, so there often is one)
      // from landing after this write and putting the old rows back.
      await queryClient.cancelQueries({ queryKey: ['reactions', chatId] });
      const previous = queryClient.getQueryData<ReactionSummaryRow[]>(['reactions', chatId]);
      queryClient.setQueryData<ReactionSummaryRow[]>(['reactions', chatId], (rows = []) =>
        applyToggle(rows, { messageId, emoji, on, userId })
      );
      return { previous };
    },
    // No `instanceof Error` guard here on purpose: PostgrestError is not an
    // Error, and React Query hands whatever was thrown straight through.
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(['reactions', chatId], context.previous);
      }
    },
    // Settled, not success: after a rollback the server is still the
    // authority on what the rows really are.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['reactions', chatId] });
    },
  });
}

export function useUnsendMessage(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => unsendMessage(messageId),
    // The thread already renders `unsent_at != null` as the UnsentNote, so
    // stamping it locally swaps the bubble the moment the person confirms
    // instead of leaving their message on screen until five invalidated
    // queries land. Only one of the two message caches exists for any given
    // thread; stamping whichever is there keeps this hook ignorant of which
    // kind it serves, the same way the invalidations below are.
    //
    // The realtime paths tolerate the early write: the direct-chat channel
    // merges rows by id (the server's UPDATE arrives with the real
    // unsent_at), and the room channel invalidates, which refetches.
    onMutate: async (messageId) => {
      // Same race useToggleReaction cancels: these caches run staleTime 0,
      // so a refetch is often in flight, and one landing after this write
      // would put the un-stamped row back until the server answered.
      await queryClient.cancelQueries({ queryKey: ['messages', chatId] });
      await queryClient.cancelQueries({ queryKey: ['room-messages', chatId] });
      const unsentAt = new Date().toISOString();
      const stamp = <T extends { id: string; unsent_at?: string | null }>(rows: T[] | undefined) =>
        rows?.map((row) => (row.id === messageId ? { ...row, unsent_at: unsentAt } : row));
      const direct = queryClient.getQueryData<ThreadMessage[]>(['messages', chatId]);
      const room = queryClient.getQueryData<RoomThreadMessage[]>(['room-messages', chatId]);
      queryClient.setQueryData(['messages', chatId], stamp(direct));
      queryClient.setQueryData(['room-messages', chatId], stamp(room));
      // The rollback restores the one stamped ROW, never the whole array: a
      // peer's message that arrives while the unsend is in flight lives in
      // the current array only (the direct channel merges each row exactly
      // once), and a snapshot rollback would erase it for good.
      return {
        directRow: direct?.find((row) => row.id === messageId),
        roomRow: room?.find((row) => row.id === messageId),
      };
    },
    // PostgrestError is not an Error — no `instanceof` guard, ever, or every
    // database refusal is silently swallowed and the rollback never runs.
    onError: (_error, messageId, context) => {
      if (context?.directRow !== undefined) {
        queryClient.setQueryData<ThreadMessage[]>(['messages', chatId], (rows) =>
          rows?.map((row) => (row.id === messageId ? context.directRow! : row))
        );
      }
      if (context?.roomRow !== undefined) {
        queryClient.setQueryData<RoomThreadMessage[]>(['room-messages', chatId], (rows) =>
          rows?.map((row) => (row.id === messageId ? context.roomRow! : row))
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
      queryClient.invalidateQueries({ queryKey: ['reactions', chatId] });
      // A pin never outlives its message. room_pins() already refuses to
      // return one whose message was taken back, but the strip is a separate
      // query: without this the person who just unsent something keeps
      // reading it at the top of the room, alone.
      queryClient.invalidateQueries({ queryKey: ['room-pins', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useRemoveRoomMessage(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => removeRoomMessage(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['room-messages', chatId] });
      // Same reason as unsend: a host who takes a pinned message down must
      // not be left looking at its headline.
      queryClient.invalidateQueries({ queryKey: ['room-pins', chatId] });
    },
  });
}
