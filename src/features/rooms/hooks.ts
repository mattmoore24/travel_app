import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

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
  fetchRoomInfo,
  fetchRoomPins,
  pinMessage,
  unpinMessage,
  subscribeToRoomMessages,
} from '@/features/rooms/api';
import { analytics } from '@/lib/analytics';
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
    queryFn: () => fetchRoomMessages(chatId!),
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
 */
export function useToggleReaction(chatId: string) {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, emoji, on }: { messageId: string; emoji: string; on: boolean }) =>
      on ? setReaction(messageId, emoji) : removeReaction(messageId, userId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reactions', chatId] });
    },
  });
}

export function useUnsendMessage(chatId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => unsendMessage(messageId),
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
