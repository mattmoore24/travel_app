import type { BrowseCity } from '@/features/pins/api';
import { cityInZone, pickBrowsingCity } from '@/features/pins/browsing-city';
import type { TripWithCity } from '@/features/trips/api';
import type { CityRow } from '@/lib/database.types';

/**
 * Which city the Chat tab's room list and the map are FOR. The rule under
 * test is §7 rule 2's client half: the choice comes from a tap or a date
 * range the traveler typed, never from a device-location read, and never
 * silently from whatever city the rail returns first — except for a guest,
 * who has typed nothing and gets the deterministic first featured city.
 *
 * Since 2026-09-04 a trip's city is ANY city: a current trip to Reykjavik
 * puts the map on Reykjavik whether or not Reykjavik has ever had a pin.
 */

const city = (id: number, name: string, timezone = 'UTC'): CityRow => ({
  id,
  name,
  country_code: 'XX',
  country_name: 'Testland',
  admin: null,
  lat: 0,
  lng: 0,
  population: 1_000_000,
  timezone,
});

const featured = (id: number, name: string, timezone = 'UTC', pins: number | null = null) =>
  ({
    city_id: id,
    timezone,
    cities: city(id, name, timezone),
    pin_count: pins,
    featured: true,
  }) satisfies BrowseCity;

const trip = (cityId: number, name: string, start: string, end: string): TripWithCity => ({
  id: `trip-${cityId}-${start}`,
  user_id: 'me',
  city_id: cityId,
  start_date: start,
  end_date: end,
  approximate: false,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  cities: city(cityId, name),
});

const LISBON = featured(1, 'Lisbon', 'Europe/Lisbon', 12);
const BANGKOK = featured(2, 'Bangkok', 'Asia/Bangkok');
const CITIES = [LISBON, BANGKOK];
const TODAY = '2026-08-30';

describe('pickBrowsingCity', () => {
  it('picks the city of the trip containing today', () => {
    const trips = [trip(2, 'Bangkok', '2026-08-25', '2026-09-05')];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toMatchObject({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('falls forward to the earliest upcoming trip when no trip contains today', () => {
    const trips = [
      trip(1, 'Lisbon', '2026-12-01', '2026-12-09'),
      trip(2, 'Bangkok', '2026-09-10', '2026-09-20'),
    ];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toMatchObject({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('browses a trip city that is not on the rail, built from the trip itself', () => {
    // A city can be anywhere now: a current trip to Reykjavik puts the map on
    // Reykjavik, with its coordinate and clock off the trip's own row.
    const trips = [trip(99, 'Reykjavik', '2026-08-25', '2026-09-05')];
    const picked = pickBrowsingCity(CITIES, trips, TODAY);
    expect(picked).toMatchObject({ cityId: 99, cityName: 'Reykjavik' });
    expect(picked.city).toMatchObject({ city_id: 99, featured: false, pin_count: null });
  });

  it("a trip city that IS on the rail comes back as the rail's own row, count and all", () => {
    const trips = [trip(1, 'Lisbon', '2026-08-25', '2026-09-05')];
    expect(pickBrowsingCity(CITIES, trips, TODAY).city).toBe(LISBON);
  });

  it('gives a traveler with no trips the first featured city, named', () => {
    // Deterministic on purpose: the rail orders by plans, then launch, then
    // size, so the fallback cannot flip between refetches. A guest always
    // lands here.
    expect(pickBrowsingCity(CITIES, [], TODAY)).toMatchObject({ cityId: 1, cityName: 'Lisbon' });
  });

  it('answers null, not a crash, before the rail arrives', () => {
    expect(pickBrowsingCity([], [], TODAY)).toEqual({ cityId: null, cityName: null, city: null });
  });

  it('prefers the trip happening now over an earlier-starting future trip', () => {
    const trips = [
      trip(2, 'Bangkok', '2026-08-29', '2026-08-31'),
      trip(1, 'Lisbon', '2026-09-01', '2026-09-09'),
    ];
    expect(pickBrowsingCity(CITIES, trips, TODAY)).toMatchObject({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('the persisted choice beats everything, including a current trip', () => {
    // A tap the person made is the most explicit signal there is; a trip is
    // an inference about it.
    const trips = [trip(1, 'Lisbon', '2026-08-25', '2026-09-05')];
    expect(pickBrowsingCity(CITIES, trips, TODAY, BANGKOK)).toMatchObject({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('a persisted choice off the rail still wins, as the snapshot it was stored as', () => {
    // A city reached by search or by a pin that landed elsewhere is not on
    // the rail, and the store carries enough to fly there before any query
    // answers.
    const porto = { ...featured(3, 'Porto', 'Europe/Lisbon'), featured: false };
    const trips = [trip(2, 'Bangkok', '2026-09-10', '2026-09-20')];
    expect(pickBrowsingCity(CITIES, trips, TODAY, porto).city).toBe(porto);
  });

  it("a persisted choice that is on the rail comes back as the rail's row, so the count is live", () => {
    const stale = { ...LISBON, pin_count: null };
    expect(pickBrowsingCity(CITIES, [], TODAY, stale).city).toBe(LISBON);
  });

  it("with no choice and no trips, the device's clock zone picks the city", () => {
    // Intl's zone name, never a location read: a phone set to Asia/Bangkok
    // opens on Bangkok instead of whichever row sorts first.
    expect(pickBrowsingCity(CITIES, [], TODAY, null, 'Asia/Bangkok')).toMatchObject({
      cityId: 2,
      cityName: 'Bangkok',
    });
  });

  it('a trip still beats the clock zone', () => {
    const trips = [trip(1, 'Lisbon', '2026-09-10', '2026-09-20')];
    expect(pickBrowsingCity(CITIES, trips, TODAY, null, 'Asia/Bangkok')).toMatchObject({
      cityId: 1,
      cityName: 'Lisbon',
    });
  });

  it('an unmatched zone falls to the first featured city', () => {
    expect(pickBrowsingCity(CITIES, [], TODAY, null, 'Europe/Berlin')).toMatchObject({
      cityId: 1,
      cityName: 'Lisbon',
    });
  });
});

/**
 * The clock-zone match on its own. Extracted from pickBrowsingCity so the
 * business signup's set-the-pin map can open on the same city at country
 * scale: Intl's zone name, never a location read (section 7 rule 2).
 */
describe('cityInZone', () => {
  it('returns the featured city whose timezone is the device zone', () => {
    expect(cityInZone(CITIES, 'Asia/Bangkok')).toBe(BANGKOK);
    expect(cityInZone(CITIES, 'Europe/Lisbon')).toBe(LISBON);
  });

  it('answers null for a zone no featured city is on', () => {
    // No "nearest" guess: a phone on Europe/Berlin is not in Lisbon, and the
    // map that opens on null opens on the world instead.
    expect(cityInZone(CITIES, 'Europe/Berlin')).toBeNull();
  });

  it('answers null for a null zone, and never throws on an empty rail', () => {
    expect(cityInZone(CITIES, null)).toBeNull();
    expect(cityInZone([], 'Asia/Bangkok')).toBeNull();
    expect(cityInZone([], null)).toBeNull();
  });

  it('is the third step of pickBrowsingCity, so the two cannot disagree', () => {
    expect(pickBrowsingCity(CITIES, [], TODAY, null, 'Asia/Bangkok').city).toBe(
      cityInZone(CITIES, 'Asia/Bangkok')
    );
  });
});
