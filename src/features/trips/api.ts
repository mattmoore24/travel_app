import type { CityRow, TripRow } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

export type TripWithCity = TripRow & { cities: CityRow };

export async function searchCities(query: string) {
  const { data, error } = await supabase.rpc('search_cities', { p_query: query });
  if (error) {
    throw error;
  }
  return (data ?? []) as CityRow[];
}

export async function fetchMyTrips(userId: string) {
  const { data, error } = await supabase
    .from('trips')
    .select('*, cities(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('start_date');
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as TripWithCity[];
}

export async function createTrip(
  userId: string,
  cityId: number,
  startDate: string,
  endDate: string
) {
  const { data, error } = await supabase
    .from('trips')
    .insert({ user_id: userId, city_id: cityId, start_date: startDate, end_date: endDate })
    .select('*, cities(*)')
    .single();
  if (error) {
    throw error;
  }
  return data as unknown as TripWithCity;
}

export async function cancelTrip(tripId: string) {
  const { error } = await supabase.from('trips').update({ status: 'cancelled' }).eq('id', tripId);
  if (error) {
    throw error;
  }
}
