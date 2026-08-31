import type { LaunchCityWithCity } from '@/features/pins/api';
import { pickBrowsingCity } from '@/features/pins/browsing-city';
import type { TripWithCity } from '@/features/trips/api';
import type { CityRow } from '@/lib/database.types';

/**
 * Which city the Chat tab's room list is FOR. The rule under test is §7
 * rule 2's client half: the choice comes from a date range the traveler
 * typed, never from a device-location read, and never silently from
 * whatever city the launch table returns first — except for a guest, who
 * has typed nothing and gets the deterministic first launch city.
 */

const city = (id: number, name: string): CityRow => ({
  id,
  name,
  country_code: 'XX',
  country_name: 'Testland',
  admin: null,
  lat: 0,
  lng: 0,
  population: 1_000_000,
});

const launch = (id: number, name: string, timezone = 'UTC'): LaunchCityWithCity => ({
  city_id: id,
  active: true,
  radius_km: 30,
  heat_k: 3,
  timezone,
  cities: city(id, name),
});

const trip = (cityId: number, name: string, start: string, end: string): TripWithCity => ({
  id: `trip-${cityId}-${start}`,
  user_id: 'me',
  city_id: cityId,
  start_date: start,
  end_date: end,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  cities: city(cityId, name),
});

const LISBON = launch(1, 'Lisbon', 'Europe/Lisbon');
const BANGKOK = launch(2, 'Bangkok', 'Asia/Bangkok');
const CITIES = [LISBON, BANGKOK];
const TODAY = '2026-08-30';

describe('pickBrowsingCity', () => {
  it('picks the launch city of the trip containing today', () => {
    const trips = [trip(2, 'Bangkok', '2026-08-25', '2026-09-05')];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toEqual({ cityId: 2, cityName: 'Bangkok' });
  });

  it('falls forward to the earliest upcoming trip when no trip contains today', () => {
    const trips = [
      trip(1, 'Lisbon', '2026-12-01', '2026-12-09'),
      trip(2, 'Bangkok', '2026-09-10', '2026-09-20'),
    ];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toEqual({ cityId: 2, cityName: 'Bangkok' });
  });

  it('ignores a trip in a city that is not a launch city', () => {
    // Rooms only exist in launch cities, so a current trip to Reykjavik must
    // not blank the list; the first launch city is the honest fallback.
    const trips = [trip(99, 'Reykjavik', '2026-08-25', '2026-09-05')];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toEqual({ cityId: 1, cityName: 'Lisbon' });
  });

  it('gives a traveler with no trips the first launch city, named', () => {
    // Deterministic on purpose: fetchLaunchCities orders by city_id, so the
    // fallback cannot flip between refetches. A guest always lands here.
    expect(pickBrowsingCity(CITIES, [], TODAY)).toEqual({ cityId: 1, cityName: 'Lisbon' });
  });

  it('answers null, not a crash, before the launch list arrives', () => {
    expect(pickBrowsingCity([], [], TODAY)).toEqual({ cityId: null, cityName: null });
  });

  it('prefers the trip happening now over an earlier-starting future trip', () => {
    const trips = [
      trip(2, 'Bangkok', '2026-08-29', '2026-08-31'),
      trip(1, 'Lisbon', '2026-09-01', '2026-09-09'),
    ];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toEqual({ cityId: 2, cityName: 'Bangkok' });
  });

  it('the persisted choice beats everything, including a current trip', () => {
    // A tap the person made is the most explicit signal there is; a trip is
    // an inference about it.
    const trips = [trip(1, 'Lisbon', '2026-08-25', '2026-09-05')];
    expect(pickBrowsingCity(CITIES, trips, TODAY, 2)).toEqual({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('a persisted city that has left the programme falls through, never an empty map', () => {
    // fetchLaunchCities serves active rows only, so a deactivated stored id
    // simply is not in the list; the trip (then timezone, then first) answers
    // instead of a city with nothing behind it.
    const trips = [trip(2, 'Bangkok', '2026-09-10', '2026-09-20')];
    expect(pickBrowsingCity(CITIES, trips, TODAY, 99)).toEqual({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it("with no choice and no trips, the device's clock zone picks the city", () => {
    // Intl's zone name, never a location read: a phone set to Asia/Bangkok
    // opens on Bangkok instead of whichever row sorts first.
    expect(pickBrowsingCity(CITIES, [], TODAY, null, 'Asia/Bangkok')).toEqual({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('a trip still beats the clock zone', () => {
    const trips = [trip(1, 'Lisbon', '2026-09-10', '2026-09-20')];
    expect(pickBrowsingCity(CITIES, trips, TODAY, null, 'Asia/Bangkok')).toEqual({
      cityId: 1,
      cityName: 'Lisbon',
    });
  });

  it('an unmatched zone falls to the first launch city', () => {
    expect(pickBrowsingCity(CITIES, [], TODAY, null, 'Europe/Berlin')).toEqual({
      cityId: 1,
      cityName: 'Lisbon',
    });
  });
});
