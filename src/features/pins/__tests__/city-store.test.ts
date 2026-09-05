import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'node:fs';
import path from 'node:path';

import type { BrowseCity } from '@/features/pins/api';
import { hydrateCityChoice, useCityChoice } from '@/features/pins/city-store';

/**
 * The persisted city choice: the fix for a hero screen that opened on
 * Bangkok for every user on every launch, forever. The store half runs for
 * real against the AsyncStorage mock; the map's wiring is read as source,
 * because the screen mounts react-native-maps and cannot mount in jest.
 */
const KEY = 'samewhere.map.city.v2';

/** A city as the map hands it to the store: the rail's row, count included. */
const city = (id: number, name: string, pins: number | null = 5): BrowseCity => ({
  city_id: id,
  timezone: 'Europe/Lisbon',
  cities: {
    id,
    name,
    country_code: 'PT',
    country_name: 'Portugal',
    admin: null,
    lat: 38.7,
    lng: -9.1,
    population: 500_000,
    timezone: 'Europe/Lisbon',
  },
  pin_count: pins,
  featured: true,
});
const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, 'src', file), 'utf8');

beforeEach(async () => {
  await AsyncStorage.clear();
  useCityChoice.setState({ city: null, hydrated: false });
});

describe('useCityChoice', () => {
  it('a chosen city is written whole under the versioned key, minus its live count', async () => {
    useCityChoice.getState().chooseCity(city(3, 'Porto'));
    expect(useCityChoice.getState().city).toMatchObject({
      city_id: 3,
      cities: { name: 'Porto', lat: 38.7 },
      // The count is the answer to a question about right now; the map
      // re-asks the rail for it and must not read a stale one off disk.
      pin_count: null,
    });
    expect(useCityChoice.getState().hydrated).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null')).toMatchObject({
      city_id: 3,
      cities: { name: 'Porto', lng: -9.1 },
      timezone: 'Europe/Lisbon',
    });
  });

  it('hydration reads the stored city back, coordinate and clock included', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(city(2, 'Lisbon')));
    await hydrateCityChoice();
    expect(useCityChoice.getState()).toMatchObject({
      city: { city_id: 2, timezone: 'Europe/Lisbon', cities: { name: 'Lisbon', lat: 38.7 } },
      hydrated: true,
    });
  });

  it('an empty, unreadable or half-shaped store starts unchosen, hydrated either way', async () => {
    await hydrateCityChoice();
    expect(useCityChoice.getState()).toMatchObject({ city: null, hydrated: true });
    for (const raw of ['not-json', '3', JSON.stringify({ city_id: 3 }), JSON.stringify(null)]) {
      await AsyncStorage.setItem(KEY, raw);
      useCityChoice.setState({ city: null, hydrated: false });
      await hydrateCityChoice();
      expect(useCityChoice.getState()).toMatchObject({ city: null, hydrated: true });
    }
  });

  it('the old key, which held a bare id, is not read', async () => {
    await AsyncStorage.setItem('samewhere.map.city.v1', '2');
    await hydrateCityChoice();
    expect(useCityChoice.getState()).toMatchObject({ city: null, hydrated: true });
  });

  it('a choice made before the read lands is not overwritten by it', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(city(2, 'Lisbon')));
    const inFlight = hydrateCityChoice();
    useCityChoice.getState().chooseCity(city(4, 'Faro'));
    await inFlight;
    expect(useCityChoice.getState().city?.city_id).toBe(4);
  });
});

describe('the wiring the founder metrics depend on', () => {
  it('map_viewed separates a chosen city from a defaulted one, and counts the cityless', () => {
    const map = src('features/pins/map-screen.tsx');
    expect(map).toContain('city_id: activeCityId ?? null');
    // A chip tap and nothing else. A business's city is resolved from its
    // listing (never the store the chips write), so it must not report as a
    // choice — business-map.test.ts pins that half.
    expect(map).toContain('explicit: businessCityId == null && chosenCityId != null');
    // The switch itself is an event, so "chose Lisbon" and "defaulted there"
    // are different lines on the chart.
    expect(map).toContain("analytics.capture('city_switched', { city_id: city.city_id });");
  });

  it('the resolution runs on the persisted choice and holds for hydration', () => {
    const map = src('features/pins/map-screen.tsx');
    expect(map).toContain(
      'pickBrowsingCity(featured, myTrips, today, chosenCity, deviceTimezone())'
    );
    expect(map).toContain('cityHydrated');
  });

  it('the chat tab reads the same store, so both tabs browse one city', () => {
    expect(src('app/(tabs)/chat.tsx')).toContain('useBrowsingCity()');
    expect(src('features/pins/browsing-city.ts')).toContain('useCityChoice((s) => s.city)');
  });

  it('no half of the city resolution ever reads device location', () => {
    for (const file of ['features/pins/browsing-city.ts', 'features/pins/city-store.ts']) {
      // The word appears in browsing-city's own warning comment; the import
      // is what must never exist.
      expect(src(file)).not.toMatch(/from 'expo-location'/);
    }
    expect(src('features/pins/browsing-city.ts')).toContain(
      'Intl.DateTimeFormat().resolvedOptions()'
    );
  });
});
