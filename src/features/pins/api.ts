import type { CityPinRow, CityRow, HeatCellRow, PinCategory } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type LaunchCityWithCity = {
  city_id: number;
  active: boolean;
  radius_km: number;
  heat_k: number;
  cities: CityRow;
};

export async function fetchLaunchCities() {
  const { data, error } = await supabase
    .from('launch_cities')
    .select('city_id, active, radius_km, heat_k, cities(*)')
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

export async function deletePin(pinId: string) {
  const { error } = await supabase.from('pins').delete().eq('id', pinId);
  if (error) {
    throw error;
  }
}
