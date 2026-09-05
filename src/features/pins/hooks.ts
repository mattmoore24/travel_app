import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';

import { useRefetchOnRefocus } from '@/hooks/use-refetch-on-refocus';

import {
  deletePin,
  fetchCity,
  fetchCityPins,
  fetchFeaturedCities,
  fetchHeatCells,
  fetchLaunchCities,
  fetchPinCrew,
  joinPinChat,
} from '@/features/pins/api';
import { useIsBusiness } from '@/features/business/hooks';
import { useIsGuest, useWantsBusiness } from '@/features/guest/hooks';
import { usePushPrimer } from '@/features/notifications/primer-store';
import { analytics } from '@/lib/analytics';
import type { CityRow, HeatCellRow, PinCategory } from '@/lib/database.types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

/**
 * The founder's launch cities: the seed of the map's rail, the seeded
 * venues' home, and a per-city override for k and the clock. Since
 * 2026-09-05 not where a business can list either; that is any city,
 * resolved from its marker, and read back by id through useCity.
 */
export function useLaunchCities() {
  return useQuery({
    queryKey: ['launch-cities'],
    queryFn: fetchLaunchCities,
    enabled: isSupabaseConfigured,
    staleTime: 60 * 60 * 1000, // launch cities change on founder action, not per-session
  });
}

/**
 * One city by id, for the rows that point at any of the ~49,000: a
 * business's own city on its map, its editor, its place sheet and the
 * listing preview. No auth gate: SELECT on cities is granted to anon too.
 */
export function useCity(cityId: number | null) {
  return useQuery({
    queryKey: ['city', cityId],
    queryFn: () => fetchCity(cityId!),
    enabled: isSupabaseConfigured && cityId != null,
    staleTime: Infinity, // a city's row does not change under a session
  });
}

/**
 * The map's rail: the launch cities plus any city whose visible plans clear
 * its k, most plans first, each carrying its count. The SAME door useMapPins
 * picks, and for the same reason: a rail computed under different visibility
 * rules would name a city whose plans the map behind it does not draw. A
 * business and a signed-out visitor both read the identity-free side; a
 * member reads the one RLS answers.
 */
export function useFeaturedCities() {
  const isGuest = useIsGuest();
  const isBusiness = useIsBusiness();
  const wantsBusiness = useWantsBusiness();
  const anonymous = isGuest || isBusiness || wantsBusiness;
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: ['featured-cities', anonymous ? 'anonymous' : 'identified'],
    queryFn: () => fetchFeaturedCities(anonymous),
    enabled: isSupabaseConfigured,
    // Slower than the pins themselves: a chip that is one plan out of date
    // for a minute is telling the truth about a minute ago, and the rail is
    // read at a glance rather than counted.
    staleTime: 60_000,
    refetchInterval: focused ? 120_000 : false,
  });
  useRefetchOnRefocus(focused, query);
  return query;
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

/**
 * THE CALLS 20260902190000 ADDED.
 *
 * `supabase.rpc` is typed from src/lib/database.types.ts, which enumerates
 * every function by name and by argument, and that file is not this
 * package's to edit — so the typed client refuses these calls outright even
 * though the functions exist and are granted. This is the narrowest hole
 * that lets them through: one indirection, in one file, named so nobody
 * mistakes it for a convenience. Delete it and send the calls back through
 * `supabase.rpc` the moment database.types.ts carries
 *
 *   heat_history_cells     Args: { p_city_id }       Returns: HeatCellRow[]
 *
 * (The rail's two counting functions and the ask-for-a-city RPC went with
 * 20260904120000; featured_cities is typed and goes through supabase.rpc.)
 */
function callRpc(fn: string, args: Record<string, unknown> = {}) {
  // Through the client rather than a detached method, so `this` survives.
  const client = supabase as unknown as {
    rpc: (
      name: string,
      params: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: unknown }>;
  };
  return client.rpc(fn, args);
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
  /**
   * The hour the plan is for, 'HH:MM', or null for "sometime that day".
   * Optional end to end: no default in the form, no default in the column,
   * and a pin without one is a first-class pin.
   */
  intentTime?: string | null;
  /**
   * The end of the window, 'HH:MM', when the plan is "from 7 to 10" rather
   * than "at 7". An end at or before the start means past midnight. Sent only
   * with a start; the column refuses it alone.
   */
  intentTimeEnd?: string | null;
  /**
   * The author said the time is to be decided. An answer the card prints
   * ("Time TBD"), unlike no hour at all, which prints nothing.
   */
  timeTbd?: boolean;
  expiresAt: string;
  /**
   * Ticked "anyone can join": the pin arrives carrying a group chat and one
   * tap puts somebody in it. Off is the original shape, where meeting starts
   * with a hello that has to be accepted.
   */
  joinable?: boolean;
  /**
   * The listed business this plan names, when the form was opened from that
   * business's page ('Plan to go', src/app/place/[id].tsx). Null or absent
   * for a pin dropped on the map, where validate_pin may still infer one by
   * exact name and sixty metres (20260902190000).
   */
  businessId?: string | null;
};

export type PostedPin = {
  id: string;
  /** The city the pin RESOLVED to, which is the browsed city unless the spot was far from it. */
  city_id: number;
  /** That city as a row, so the map can follow the pin there. */
  city: CityRow | null;
  category: PinCategory;
  intent_date: string;
  /** The group it opened with, when it was posted open to join. */
  chat_id: string | null;
};

export function useCreatePin() {
  const queryClient = useQueryClient();
  return useMutation({
    // ONE WRITE PATH, and the hour is why. Pins are immutable to the client
    // (no UPDATE grant, 20260816210000), so an optional hour has to arrive
    // with the insert or never — and the message-me-first shape used to go
    // through a plain column-listed insert in features/pins/api.ts that has
    // no room for it. Both shapes come through post_joinable_pin now, with
    // p_joinable saying which; nothing is loosened by the move, since the
    // function sets user_id from auth.uid() and seeded to false (exactly what
    // the pins_insert_own policy checks) and additionally refuses a suspended
    // account and a business.
    //
    // Both shapes still answer with the same four things, because that is all
    // anybody downstream reads: the id to select the new pin's card, and the
    // three fields the analytics event wants. The joinable path also carries
    // the chat it opened.
    mutationFn: async ({ joinable, ...input }: NewPin): Promise<PostedPin> => {
      const { data, error } = await callRpc('post_joinable_pin', {
        p_city_id: input.cityId,
        p_venue_name: input.venueName,
        p_note: input.note ?? null,
        p_plan: input.plan ?? null,
        p_place_label: input.placeLabel ?? null,
        p_category: input.category,
        p_lat: input.lat,
        p_lng: input.lng,
        p_intent_date: input.intentDate,
        p_intent_time: input.intentTime ?? null,
        p_expires_at: input.expiresAt,
        p_joinable: joinable === true,
        // Sent ONLY when it has a value. PostgREST resolves an RPC by the
        // argument names it is given, so naming an argument against a
        // server that predates it would fail EVERY pin post for as long as
        // the bundle led the deploy. Left out, an ordinary pin keeps working
        // in either order; only the feature that needs the argument waits.
        ...(input.businessId ? { p_business_id: input.businessId } : {}),
        ...(input.intentTimeEnd ? { p_intent_time_end: input.intentTimeEnd } : {}),
        ...(input.timeTbd ? { p_time_tbd: true } : {}),
      });
      if (error) {
        throw error;
      }
      const { pin_id, chat_id, city } = data as {
        pin_id: string;
        chat_id: string | null;
        city?: CityRow | null;
      };
      return {
        id: pin_id,
        // The server's answer, not the form's: a pin dropped in Manhattan
        // while the Bangkok chip was lit belongs to New York.
        city_id: city?.id ?? input.cityId,
        city: city ?? null,
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
      // The rail prints the same number the map draws, so it goes stale on
      // exactly the same event - and a first pin in a new city can put that
      // city on the rail.
      queryClient.invalidateQueries({ queryKey: ['featured-cities'] });
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
        // Which SHAPE of pin failed. One function serves both now, but they
        // take different branches through it — the joinable one opens a
        // group and answers to a daily cap the other never meets — so a
        // failure in one still says nothing about the other.
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
      queryClient.invalidateQueries({ queryKey: ['city-pin-counts'] });
    },
  });
}

/**
 * Where a city has usually been busy at this hour on this weekday, drawn
 * under the live layer so a quiet Tuesday still says something.
 *
 * No day parameter and no hour parameter. The server knows the city's own
 * clock (launch_cities.timezone) and answers for its right now, so there is
 * nothing here for a caller to get wrong and no option defaulted off. The
 * k-threshold is entirely the server's, twice over: every stored bucket
 * already cleared it live, and a cell needs at least k separate days before
 * it is returned at all.
 */
export function useHeatHistory(cityId: number | null) {
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: ['heat-history', cityId],
    queryFn: async () => {
      const { data, error } = await callRpc('heat_history_cells', { p_city_id: cityId! });
      if (error) {
        throw error;
      }
      return (data ?? []) as HeatCellRow[];
    },
    enabled: isSupabaseConfigured && cityId != null,
    // History moves at the speed of an hour band, so this is the one map
    // query with no polling at all: it is refetched when the tab comes back
    // and otherwise left alone.
    staleTime: 30 * 60 * 1000,
  });
  useRefetchOnRefocus(focused, query);
  return query;
}
