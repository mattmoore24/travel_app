import AsyncStorage from '@react-native-async-storage/async-storage';
import fs from 'node:fs';
import path from 'node:path';

import { hydrateCityChoice, useCityChoice } from '@/features/pins/city-store';

/**
 * The persisted city choice: the fix for a hero screen that opened on
 * Bangkok for every user on every launch, forever. The store half runs for
 * real against the AsyncStorage mock; the map's wiring is read as source,
 * because the screen mounts react-native-maps and cannot mount in jest.
 */
const KEY = 'samewhere.map.city.v1';
const REPO = path.join(__dirname, '..', '..', '..', '..');
const src = (file: string): string => fs.readFileSync(path.join(REPO, 'src', file), 'utf8');

beforeEach(async () => {
  await AsyncStorage.clear();
  useCityChoice.setState({ cityId: null, hydrated: false });
});

describe('useCityChoice', () => {
  it('a chosen city is written under the versioned key', async () => {
    useCityChoice.getState().chooseCity(3);
    expect(useCityChoice.getState()).toMatchObject({ cityId: 3, hydrated: true });
    expect(await AsyncStorage.getItem(KEY)).toBe('3');
  });

  it('hydration reads the stored choice back', async () => {
    await AsyncStorage.setItem(KEY, '2');
    await hydrateCityChoice();
    expect(useCityChoice.getState()).toMatchObject({ cityId: 2, hydrated: true });
  });

  it('an empty or unreadable store starts unchosen, hydrated either way', async () => {
    await hydrateCityChoice();
    expect(useCityChoice.getState()).toMatchObject({ cityId: null, hydrated: true });
    await AsyncStorage.setItem(KEY, 'not-a-number');
    useCityChoice.setState({ cityId: null, hydrated: false });
    await hydrateCityChoice();
    expect(useCityChoice.getState()).toMatchObject({ cityId: null, hydrated: true });
  });

  it('a choice made before the read lands is not overwritten by it', async () => {
    await AsyncStorage.setItem(KEY, '2');
    const inFlight = hydrateCityChoice();
    useCityChoice.getState().chooseCity(4);
    await inFlight;
    expect(useCityChoice.getState().cityId).toBe(4);
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
    expect(map).toContain("analytics.capture('city_switched', { city_id: id });");
  });

  it('the resolution runs on the persisted choice and holds for hydration', () => {
    const map = src('features/pins/map-screen.tsx');
    expect(map).toContain('pickBrowsingCity(launchCities, myTrips, toISODate(new Date())');
    expect(map).toContain('cityHydrated');
  });

  it('the chat tab reads the same store, so both tabs browse one city', () => {
    expect(src('app/(tabs)/chat.tsx')).toContain('useBrowsingCity()');
    expect(src('features/pins/browsing-city.ts')).toContain('useCityChoice((s) => s.cityId)');
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
