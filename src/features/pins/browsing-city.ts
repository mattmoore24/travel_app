import type { LaunchCityWithCity } from '@/features/pins/api';
import { useLaunchCities } from '@/features/pins/hooks';
import type { TripWithCity } from '@/features/trips/api';
import { useMyTrips } from '@/features/trips/hooks';
import { toISODate } from '@/features/trips/dates';

/**
 * Which launch city this traveler is browsing, and what it is called.
 *
 * Chosen, never assumed — src/app/business-signup.tsx:150 states the same
 * rule for the other side of the marketplace: "This used to fall back to
 * `launchCities[0]`". The Chat tab's room list did exactly that, so a
 * traveler in Bangkok read that Lisbon hostels were "near you".
 *
 * The input is a date range the traveler TYPED — their trips — never device
 * location. That is what keeps §7 rule 2 intact: the app never collects or
 * displays where anybody is. Anybody "improving" this later will reach for
 * expo-location; do not.
 */
export type BrowsingCity = {
  cityId: number | null;
  cityName: string | null;
};

/**
 * The launch city of the trip containing `today`, else the earliest upcoming
 * trip whose city is a launch city, else the first launch city (deterministic
 * — fetchLaunchCities orders by city_id — and all a guest with no trips can
 * get).
 */
export function pickBrowsingCity(
  launchCities: LaunchCityWithCity[],
  trips: TripWithCity[],
  today: string
): BrowsingCity {
  const launchById = new Map(launchCities.map((city) => [city.city_id, city]));
  const inLaunchCity = trips.filter((trip) => launchById.has(trip.city_id));

  const current = inLaunchCity.find((trip) => trip.start_date <= today && today <= trip.end_date);
  const upcoming = inLaunchCity
    .filter((trip) => trip.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];

  const trip = current ?? upcoming;
  if (trip) {
    return {
      cityId: trip.city_id,
      cityName: launchById.get(trip.city_id)?.cities.name ?? null,
    };
  }
  const first = launchCities[0];
  return { cityId: first?.city_id ?? null, cityName: first?.cities.name ?? null };
}

/**
 * The hook the screens use. useMyTrips is already cached from the profile
 * tab and disabled without a user id, so a guest costs nothing extra and
 * falls through to the first launch city.
 */
export function useBrowsingCity(): BrowsingCity {
  const { data: launchCities = [] } = useLaunchCities();
  const { data: trips = [] } = useMyTrips();
  return pickBrowsingCity(launchCities, trips, toISODate(new Date()));
}
