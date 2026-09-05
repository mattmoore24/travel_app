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

/** What one save is allowed to move, in the shape PostgREST is handed. */
type TripPatch = Partial<Pick<TripRow, 'city_id' | 'start_date' | 'end_date' | 'approximate'>>;

/**
 * PostgREST's answer when the payload names a column its schema cache has
 * never heard of: "Could not find the 'x' column of 'y' in the schema cache".
 * It is a PostgrestError, not an Error, so `instanceof` cannot be used on it.
 */
function unknownColumn(error: { code?: string | null } | null): boolean {
  return error?.code === 'PGRST204';
}

export async function updateTrip(
  tripId: string,
  patch: { cityId?: number; startDate?: string; endDate?: string; approximate?: boolean }
) {
  const row: TripPatch = {
    ...(patch.cityId != null ? { city_id: patch.cityId } : {}),
    ...(patch.startDate != null ? { start_date: patch.startDate } : {}),
    ...(patch.endDate != null ? { end_date: patch.endDate } : {}),
    // Sent on every save that touches the dates, never omitted when false.
    // An absent field is dropped here, so an editor that only sent `true`
    // could turn an exact trip rough and never turn it back - the same
    // shape as the missing end date this function's caller documents.
    ...(patch.approximate != null ? { approximate: patch.approximate } : {}),
  };
  const { error } = await supabase.from('trips').update(row).eq('id', tripId);
  if (error == null) {
    return;
  }
  // The deploy window, on the one write path that had no guard for it.
  //
  // supabase-deploy and testflight are independent workflow_dispatch jobs
  // with no `needs:` between them, so an over-the-air update can reach a
  // phone before 20260902230000 applies. PostgREST answers a payload key it
  // has no column for with PGRST204 and rejects the WHOLE statement, so
  // without this a plain date change - on a trip nobody ever called rough -
  // fails, on the screen the Travelers tab sends people to first.
  //
  // Only `approximate: false` is retried without the field, and that is the
  // whole rule. A project with no column has no rough trips in it, so false
  // is what a re-read would say anyway and dropping it changes nothing. A
  // `true` is a claim about somebody's dates that the database cannot hold;
  // silently storing the window as exact would print a guess as a fact on a
  // stranger's screen, which is the sentence 20260902230000 exists to stop.
  // That one fails loudly instead, and the person tries again after deploy.
  if (unknownColumn(error) && patch.approximate === false) {
    const withoutFlag: TripPatch = { ...row };
    delete withoutFlag.approximate;
    // The flag was the only thing in the payload: there is nothing left to
    // write, and nothing that needed writing.
    if (Object.keys(withoutFlag).length === 0) {
      return;
    }
    const retry = await supabase.from('trips').update(withoutFlag).eq('id', tripId);
    if (retry.error) {
      throw retry.error;
    }
    return;
  }
  throw error;
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
  endDate: string,
  approximate = false
) {
  const { data, error } = await supabase
    .from('trips')
    .insert({
      user_id: userId,
      city_id: cityId,
      start_date: startDate,
      end_date: endDate,
      // Additive, the same way every READ in this change is additive
      // (FeaturedTravelerRow.approximate is optional, useFeaturedPhoto takes
      // both shapes). `false` is the column's own default, so omitting it
      // writes exactly the same row - and on a phone that got the update
      // before 20260902230000 applied it is the difference between posting an
      // ordinary trip and PGRST204. A `true` is still sent, and still fails
      // there: a window the database cannot mark as a guess must not be
      // stored as a claim.
      ...(approximate ? { approximate: true } : {}),
    })
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
