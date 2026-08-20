import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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

export function useRoomMessages(chatId: string | null) {
  return useQuery({
    queryKey: ['room-messages', chatId],
    queryFn: () => fetchRoomMessages(chatId!),
    enabled: isSupabaseConfigured && chatId != null,
    // Same reasoning as direct chats: realtime can land between renders, so
    // never serve a stale first paint.
    staleTime: 0,
    refetchOnMount: 'always',
  });
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
    },
  });
}
