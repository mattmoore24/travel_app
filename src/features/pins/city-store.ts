import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { BrowseCity } from '@/features/pins/api';

/**
 * The city this person last chose to browse, kept across cold starts.
 *
 * `activeCityId = cityId ?? launchCities[0]` was plain component state, so
 * the hero screen of a map-led product opened on Bangkok for every user on
 * every launch, forever, and a traveler in Lisbon re-picked their city every
 * single time. The choice is a tap the person made and nothing more: never a
 * location read (§7 rule 2 has a client half too), and the fallbacks when
 * there is no stored choice live in pickBrowsingCity, not here.
 *
 * THE WHOLE CITY, not an id. A chip used to be one of four rows the map had
 * already loaded, so an id was enough to find it again. Any city can be
 * chosen now (a search, a pin that landed a continent away), and the map has
 * to fly there on the next cold start before any query has answered - so the
 * snapshot carries the name, the coordinate and the clock. The rail's count
 * is NOT persisted: it is the answer to a question about right now.
 *
 * One store for every tab. The Chat tab's room list hardcoded
 * `launchCities[0]` independently, so fixing only the map would have left a
 * Lisbon traveler reading Bangkok's rooms.
 */
const KEY = 'samewhere.map.city.v2';

type CityChoiceState = {
  /** The chosen city, or null when nothing was ever chosen. */
  city: BrowseCity | null;
  /** True once the stored value (or its absence) has been read back. */
  hydrated: boolean;
  chooseCity: (city: BrowseCity) => void;
};

/** What survives a restart: the row and its clock, never the live count. */
function snapshot(city: BrowseCity): BrowseCity {
  return {
    city_id: city.city_id,
    timezone: city.timezone,
    cities: city.cities,
    pin_count: null,
    featured: city.featured,
  };
}

/** A stored value this code, or an earlier version of it, wrote. */
function parseStored(raw: string | null): BrowseCity | null {
  if (raw == null) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BrowseCity> | null;
    const row = parsed?.cities;
    if (
      parsed == null ||
      typeof parsed.city_id !== 'number' ||
      row == null ||
      typeof row.name !== 'string' ||
      typeof row.lat !== 'number' ||
      typeof row.lng !== 'number'
    ) {
      return null;
    }
    return {
      city_id: parsed.city_id,
      timezone: typeof parsed.timezone === 'string' ? parsed.timezone : null,
      cities: { ...row, id: parsed.city_id, timezone: row.timezone ?? null },
      pin_count: null,
      featured: parsed.featured === true,
    };
  } catch {
    return null;
  }
}

export const useCityChoice = create<CityChoiceState>((set) => ({
  city: null,
  hydrated: false,
  chooseCity: (city) => {
    // The state first, storage best-effort after: a device that cannot write
    // simply forgets across restarts, which is the pre-store behaviour.
    const kept = snapshot(city);
    set({ city: kept, hydrated: true });
    AsyncStorage.setItem(KEY, JSON.stringify(kept)).catch(() => {});
  },
}));

/**
 * Read the stored choice back. Runs once at module load; exported so tests
 * can await it deterministically. A choice made before the read lands wins
 * over the stale stored value it is about to replace. The v1 key held a bare
 * id and is simply not read: a first launch on this version resolves like a
 * first launch, which is one chip tap to put right.
 */
export async function hydrateCityChoice(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const stored = parseStored(raw);
    useCityChoice.setState((s) =>
      s.city != null ? { hydrated: true } : { city: stored, hydrated: true }
    );
  } catch {
    // A device that cannot read simply starts unchosen.
    useCityChoice.setState({ hydrated: true });
  }
}

void hydrateCityChoice();
