import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';

import {
  createPin,
  deletePin,
  fetchCityPins,
  fetchHeatCells,
  fetchLaunchCities,
  fetchPinCrew,
  joinPinChat,
  postJoinablePin,
} from '@/features/pins/api';
import { useOwnUserId } from '@/features/profile/hooks';
import { usePushPrimer } from '@/features/notifications/primer-store';
import { analytics } from '@/lib/analytics';
import type { PinCategory } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

export function useLaunchCities() {
  return useQuery({
    queryKey: ['launch-cities'],
    queryFn: fetchLaunchCities,
    enabled: isSupabaseConfigured,
    staleTime: 60 * 60 * 1000, // launch cities change on founder action, not per-session
  });
}

export function useCityPins(cityId: number | null) {
  // Tab-scoped polling. NativeTabs keeps the Map tab mounted, so an
  // unconditional interval kept firing while somebody read a chat — a request
  // a minute, on roaming data, for a screen nobody was looking at. Coming
  // back is refetched BY HAND below: re-arming refetchInterval never fires an
  // immediate tick, and a kept-mounted tab emits nothing React Query listens
  // to, so without it expired pins sat tappable for up to a minute after
  // every tab return.
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: ['city-pins', cityId],
    queryFn: () => fetchCityPins(cityId!),
    enabled: isSupabaseConfigured && cityId != null,
    staleTime: 20_000,
    refetchInterval: focused ? 60_000 : false,
  });
  useRefetchOnRefocus(focused, query);
  return query;
}

export function useHeatCells(cityId: number | null, date: string | null) {
  // Same tab-scoping, and the same by-hand refocus refetch, as useCityPins.
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: ['heat-cells', cityId, date],
    queryFn: () => fetchHeatCells(cityId!, date),
    enabled: isSupabaseConfigured && cityId != null,
    staleTime: 60_000,
    refetchInterval: focused ? 120_000 : false,
  });
  useRefetchOnRefocus(focused, query);
  return query;
}

export type NewPin = {
  cityId: number;
  venueName: string;
  note?: string | null;
  /** What the person is doing there. The venue names the spot. */
  plan?: string | null;
  placeLabel?: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intentDate: string;
  expiresAt: string;
  /**
   * Ticked "anyone can join": the pin arrives carrying a group chat and one
   * tap puts somebody in it. Off is the original shape, where meeting starts
   * with a hello that has to be accepted.
   */
  joinable?: boolean;
};

type PostedPin = {
  id: string;
  city_id: number;
  category: PinCategory;
  intent_date: string;
  /** The group it opened with, when it was posted open to join. */
  chat_id: string | null;
};

export function useCreatePin() {
  const userId = useOwnUserId();
  const queryClient = useQueryClient();
  return useMutation({
    // Both shapes answer with the same four things, because that is all
    // anybody downstream reads: the id to select the new pin's card, and the
    // three fields the analytics event wants. The joinable path also carries
    // the chat it opened.
    mutationFn: async ({ joinable, ...input }: NewPin): Promise<PostedPin> => {
      if (!joinable) {
        const row = await createPin({ userId: userId!, ...input });
        return {
          id: row.id,
          city_id: row.city_id,
          category: row.category,
          intent_date: row.intent_date,
          chat_id: null,
        };
      }
      const { pin_id, chat_id } = await postJoinablePin(input);
      return {
        id: pin_id,
        city_id: input.cityId,
        category: input.category,
        intent_date: input.intentDate,
        chat_id,
      };
    },
    onSuccess: (pin) => {
      analytics.capture('pin_created', {
        city_id: pin.city_id,
        category: pin.category,
        intent_date: pin.intent_date,
        joinable: pin.chat_id != null,
      });
      // Both cache families: 'city-pins'/'heat-cells' feed the web list,
      // 'map-pins'/'map-heat' (guest hooks) feed the native map. Missing the
      // second pair meant a posted pin never appeared until app restart.
      queryClient.invalidateQueries({ queryKey: ['city-pins', pin.city_id] });
      queryClient.invalidateQueries({ queryKey: ['heat-cells', pin.city_id] });
      queryClient.invalidateQueries({ queryKey: ['map-pins', pin.city_id] });
      queryClient.invalidateQueries({ queryKey: ['map-heat', pin.city_id] });
      // A pin is an invitation, so this is the other moment where being told
      // somebody answered is obviously worth something.
      usePushPrimer.getState().ask('pin-posted');
    },
    // A FAILED post used to be invisible, and pins are the supply side of the
    // whole product: no pins, no map, no heatmap, no reason to open the app.
    // Without this, a broken RPC and a city full of people who simply do not
    // want to publish intent produce exactly the same chart — a low pin rate
    // with no diagnosis. The global mutation alert still shows the person
    // what happened; this is the same event counted.
    onError: (error, input) => {
      analytics.capture('pin_post_failed', {
        reason: pinPostFailureReason(error),
        city_id: input.cityId,
        // Which of the two write paths broke. They are different functions
        // with different validations, and a failure in one says nothing
        // about the other.
        joinable: input.joinable === true,
      });
    },
  });
}

/**
 * The CLASS of a failed post, and never the message.
 *
 * The message is the dangerous half: a `raise` out of validate_pin quotes
 * what was typed, and docs/PROGRESS.md records what happens when user text
 * reaches analytics by accident. So the answer comes from a closed
 * vocabulary — a Postgres/PostgREST code, or one of three shapes — and the
 * code is bounds-checked before it is used, so even a client library that
 * one day puts prose in `code` cannot widen it into free text.
 *
 * `PostgrestError` is not an `Error` (see the traps skill), which is why the
 * code check comes first and why the `instanceof Error` arm is a fallback
 * rather than the entry point.
 */
export function pinPostFailureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Za-z]{1,10}$/.test(code)) {
      return `pg_${code}`;
    }
  }
  // React Native's fetch rejects with a TypeError when the request never
  // left the phone, which is the one non-database failure worth telling
  // apart: it is a person on a hostel wifi, not a broken migration.
  if (error instanceof TypeError) {
    return 'network';
  }
  if (error instanceof Error) {
    return 'error';
  }
  return 'unknown';
}

/**
 * Joining somebody's plan. No token, no hello: the server checks you can see
 * the pin at all and puts you in its chat.
 */
export function useJoinPinChat(cityId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pinId: string) => joinPinChat(pinId),
    onSuccess: () => {
      analytics.capture('pin_joined');
      queryClient.invalidateQueries({ queryKey: ['city-pins', cityId] });
      queryClient.invalidateQueries({ queryKey: ['map-pins', cityId] });
      // The chat list is where you land, so it has to know about the room
      // before the push, not a poll later.
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

/** Who is already going, for the faces on the pin sheet. */
export function usePinCrew(pinId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['pin-crew', pinId],
    queryFn: () => fetchPinCrew(pinId!),
    enabled: isSupabaseConfigured && enabled && pinId != null,
    staleTime: 30_000,
  });
}

export function useDeletePin(cityId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pinId: string) => deletePin(pinId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['city-pins', cityId] });
      queryClient.invalidateQueries({ queryKey: ['heat-cells', cityId] });
      queryClient.invalidateQueries({ queryKey: ['map-pins', cityId] });
      queryClient.invalidateQueries({ queryKey: ['map-heat', cityId] });
    },
  });
}
