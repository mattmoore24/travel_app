import type { LaunchCityWithCity } from '@/features/pins/api';
import { useCityChoice } from '@/features/pins/city-store';
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
 * The inputs are a tap the traveler made (the persisted chip choice), a date
 * range they TYPED (their trips), and the device's own clock setting — never
 * device location. That is what keeps §7 rule 2 intact: the app never
 * collects or displays where anybody is. Anybody "improving" this later will
 * reach for expo-location; do not.
 */
export type BrowsingCity = {
  cityId: number | null;
  cityName: string | null;
};

/**
 * The device's clock zone, from Intl and ONLY Intl. A zone name is a setting
 * somebody chose on their phone, not a position; §7 rule 2 forbids the
 * position, and this helper exists so nobody swaps in a location read to
 * answer the same question.
 */
export function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolution order, most explicit first:
 *
 *   1. the persisted choice, while that city is still an active launch city
 *      (a deactivated one falls through rather than rendering an empty map);
 *   2. the launch city of the trip containing `today`, else the earliest
 *      upcoming trip whose city is a launch city;
 *   3. the launch city whose `timezone` matches the device's clock zone;
 *   4. the first launch city (deterministic — fetchLaunchCities orders by
 *      city_id — and all a guest with no trips in Berlin can get).
 */
export function pickBrowsingCity(
  launchCities: LaunchCityWithCity[],
  trips: TripWithCity[],
  today: string,
  chosenCityId: number | null = null,
  deviceTz: string | null = null
): BrowsingCity {
  const launchById = new Map(launchCities.map((city) => [city.city_id, city]));
  const named = (cityId: number): BrowsingCity => ({
    cityId,
    cityName: launchById.get(cityId)?.cities.name ?? null,
  });

  if (chosenCityId != null && launchById.has(chosenCityId)) {
    return named(chosenCityId);
  }

  const inLaunchCity = trips.filter((trip) => launchById.has(trip.city_id));
  const current = inLaunchCity.find((trip) => trip.start_date <= today && today <= trip.end_date);
  const upcoming = inLaunchCity
    .filter((trip) => trip.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const trip = current ?? upcoming;
  if (trip) {
    return named(trip.city_id);
  }

  const zoned = deviceTz != null ? launchCities.find((city) => city.timezone === deviceTz) : null;
  if (zoned) {
    return named(zoned.city_id);
  }

  const first = launchCities[0];
  return { cityId: first?.city_id ?? null, cityName: first?.cities.name ?? null };
}

/**
 * The hook the screens use. useMyTrips is already cached from the profile
 * tab and disabled without a user id, so a guest costs nothing extra and
 * falls through to the timezone match, then the first launch city. Reads the
 * same persisted choice the map's chips write, so every tab browses ONE
 * city.
 */
export function useBrowsingCity(): BrowsingCity {
  const { data: launchCities = [] } = useLaunchCities();
  const { data: trips = [] } = useMyTrips();
  const chosenCityId = useCityChoice((s) => s.cityId);
  return pickBrowsingCity(
    launchCities,
    trips,
    toISODate(new Date()),
    chosenCityId,
    deviceTimezone()
  );
}
