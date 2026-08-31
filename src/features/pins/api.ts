import type {
  CityPinRow,
  CityRow,
  HeatCellRow,
  PinCategory,
  PinCrewRow,
} from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type LaunchCityWithCity = {
  city_id: number;
  active: boolean;
  radius_km: number;
  heat_k: number;
  /** IANA zone name for the city's own clock (launch_cities.timezone). */
  timezone: string;
  cities: CityRow;
};

export async function fetchLaunchCities() {
  const { data, error } = await supabase
    .from('launch_cities')
    .select('city_id, active, radius_km, heat_k, timezone, cities(*)')
    .eq('active', true)
    .order('city_id'); // deterministic: the default city must not flip on refetch
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as LaunchCityWithCity[];
}

export async function fetchCityPins(cityId: number) {
  const { data, error } = await supabase.rpc('city_pins', { p_city_id: cityId });
  if (error) {
    throw error;
  }
  return (data ?? []) as CityPinRow[];
}

export async function fetchHeatCells(cityId: number, date: string | null) {
  const { data, error } = await supabase.rpc('heat_cells', {
    p_city_id: cityId,
    p_date: date,
  });
  if (error) {
    throw error;
  }
  return (data ?? []) as HeatCellRow[];
}

export async function createPin(input: {
  userId: string;
  cityId: number;
  venueName: string;
  note?: string | null;
  plan?: string | null;
  placeLabel?: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intentDate: string;
  expiresAt: string;
}) {
  const { data, error } = await supabase
    .from('pins')
    .insert({
      user_id: input.userId,
      city_id: input.cityId,
      venue_name: input.venueName,
      note: input.note ?? null,
      plan: input.plan ?? null,
      place_label: input.placeLabel ?? null,
      category: input.category,
      lat: input.lat,
      lng: input.lng,
      intent_date: input.intentDate,
      expires_at: input.expiresAt,
    })
    .select()
    .single();
  if (error) {
    throw error;
  }
  return data;
}

/**
 * The same pin, posted open to join.
 *
 * One call rather than an insert and then a request for a group: a failure
 * between the two would leave a pin whose author ticked "anyone can join" and
 * which nobody can join, which is the one outcome with nothing honest to say
 * about it. The RPC does both in one transaction, and every trigger the plain
 * insert answers to still fires inside it.
 */
export async function postJoinablePin(input: {
  cityId: number;
  venueName: string;
  note?: string | null;
  plan?: string | null;
  placeLabel?: string | null;
  category: PinCategory;
  lat: number;
  lng: number;
  intentDate: string;
  expiresAt: string;
}): Promise<{ pin_id: string; chat_id: string }> {
  const { data, error } = await supabase.rpc('post_joinable_pin', {
    p_city_id: input.cityId,
    p_venue_name: input.venueName,
    p_note: input.note ?? null,
    p_plan: input.plan ?? null,
    p_place_label: input.placeLabel ?? null,
    p_category: input.category,
    p_lat: input.lat,
    p_lng: input.lng,
    p_intent_date: input.intentDate,
    p_expires_at: input.expiresAt,
  });
  if (error) {
    throw error;
  }
  return data as { pin_id: string; chat_id: string };
}

export async function joinPinChat(pinId: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_pin_chat', { p_pin_id: pinId });
  if (error) {
    throw error;
  }
  return (data as { chat_id: string }).chat_id;
}

export async function fetchPinCrew(pinId: string): Promise<PinCrewRow[]> {
  const { data, error } = await supabase.rpc('pin_crew', { p_pin_id: pinId });
  if (error) {
    throw error;
  }
  return (data ?? []) as PinCrewRow[];
}

export async function deletePin(pinId: string) {
  const { error } = await supabase.from('pins').delete().eq('id', pinId);
  if (error) {
    throw error;
  }
}
