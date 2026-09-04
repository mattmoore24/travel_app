import type { BrowseCity } from '@/features/pins/api';
import { browseCityFromCityRow } from '@/features/pins/api';
import { useCityChoice } from '@/features/pins/city-store';
import { useFeaturedCities } from '@/features/pins/hooks';
import type { TripWithCity } from '@/features/trips/api';
import { useMyTrips } from '@/features/trips/hooks';
import { toISODate } from '@/features/trips/dates';

/**
 * Which city this traveler is browsing, and what it is called.
 *
 * Chosen, never assumed — src/app/business-signup.tsx:150 states the same
 * rule for the other side of the marketplace: "This used to fall back to
 * `launchCities[0]`". The Chat tab's room list did exactly that, so a
 * traveler in Bangkok read that Lisbon hostels were "near you".
 *
 * The inputs are a tap the traveler made (the persisted choice), a date
 * range they TYPED (their trips), and the device's own clock setting — never
 * device location. That is what keeps §7 rule 2 intact: the app never
 * collects or displays where anybody is. Anybody "improving" this later will
 * reach for expo-location; do not.
 *
 * ANY CITY, since 2026-09-04. A trip to Porto used to be ignored here because
 * Porto was not one of the four; now a trip's city is a city the map can
 * browse, and so is anything chosen from search.
 */
export type BrowsingCity = {
  cityId: number | null;
  cityName: string | null;
  /** The whole city, for callers that need its coordinate or its clock. */
  city: BrowseCity | null;
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

const NOWHERE: BrowsingCity = { cityId: null, cityName: null, city: null };

function named(city: BrowseCity): BrowsingCity {
  return { cityId: city.city_id, cityName: city.cities.name, city };
}

/**
 * Resolution order, most explicit first:
 *
 *   1. the persisted choice (any city; the rail's own row for it when it is
 *      on the rail, so the count comes along);
 *   2. the city of the trip containing `today`, else the earliest upcoming
 *      trip's city;
 *   3. the featured city whose `timezone` matches the device's clock zone;
 *   4. the first featured city (deterministic — the rail orders by plans,
 *      then launch cities, then size — and all a guest with no trips gets).
 */
export function pickBrowsingCity(
  featured: BrowseCity[],
  trips: TripWithCity[],
  today: string,
  chosen: BrowseCity | null = null,
  deviceTz: string | null = null
): BrowsingCity {
  const onRail = new Map(featured.map((city) => [city.city_id, city]));

  if (chosen != null) {
    return named(onRail.get(chosen.city_id) ?? chosen);
  }

  const current = trips.find((trip) => trip.start_date <= today && today <= trip.end_date);
  const upcoming = trips
    .filter((trip) => trip.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))[0];
  const trip = current ?? upcoming;
  if (trip) {
    return named(onRail.get(trip.city_id) ?? browseCityFromCityRow(trip.cities));
  }

  const zoned = deviceTz != null ? featured.find((city) => city.timezone === deviceTz) : null;
  if (zoned) {
    return named(zoned);
  }

  const first = featured[0];
  return first ? named(first) : NOWHERE;
}

/**
 * The hook the screens use. useMyTrips is already cached from the profile
 * tab and disabled without a user id, so a guest costs nothing extra and
 * falls through to the timezone match, then the first featured city. Reads
 * the same persisted choice the map's chips write, so every tab browses ONE
 * city.
 */
export function useBrowsingCity(): BrowsingCity {
  const { data: featured = [] } = useFeaturedCities();
  const { data: trips = [] } = useMyTrips();
  const chosen = useCityChoice((s) => s.city);
  return pickBrowsingCity(featured, trips, toISODate(new Date()), chosen, deviceTimezone());
}
