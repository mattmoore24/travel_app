import type { CityRow, TravelerTripRow, TripRow } from '@/lib/database.types';
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
  // Trips that have already finished are history, not plans — they belong
  // on nobody's profile, including your own.
  const today = new Date();
  const cutoff = `${today.getFullYear()}-${`${today.getMonth() + 1}`.padStart(2, '0')}-${`${today.getDate()}`.padStart(2, '0')}`;
  const { data, error } = await supabase
    .from('trips')
    .select('*, cities(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gte('end_date', cutoff)
    .order('start_date');
  if (error) {
    throw error;
  }
  return (data ?? []) as unknown as TripWithCity[];
}

/** Another traveler's upcoming plans, gated server-side by traveler_trips(). */
export async function fetchTravelerTrips(userId: string) {
  const { data, error } = await supabase.rpc('traveler_trips', { p_user_id: userId });
  if (error) {
    throw error;
  }
  return (data ?? []) as TravelerTripRow[];
}

export async function updateTrip(
  tripId: string,
  patch: { cityId?: number; startDate?: string; endDate?: string }
) {
  const { error } = await supabase
    .from('trips')
    .update({
      ...(patch.cityId != null ? { city_id: patch.cityId } : {}),
      ...(patch.startDate != null ? { start_date: patch.startDate } : {}),
      ...(patch.endDate != null ? { end_date: patch.endDate } : {}),
    })
    .eq('id', tripId);
  if (error) {
    throw error;
  }
}

/** Removes the trip outright — "delete" on a profile should mean deleted. */
export async function deleteTrip(tripId: string) {
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) {
    throw error;
  }
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
