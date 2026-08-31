import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/**
 * The launch city this person last chose, kept across cold starts.
 *
 * `activeCityId = cityId ?? launchCities[0]` was plain component state, so
 * the hero screen of a map-led product opened on Bangkok for every user on
 * every launch, forever, and a traveler in Lisbon re-picked their city every
 * single time. The choice is a tap the person made and nothing more: never a
 * location read (§7 rule 2 has a client half too), and the fallbacks when
 * there is no stored choice live in pickBrowsingCity, not here.
 *
 * One store for every tab. The Chat tab's room list hardcoded
 * `launchCities[0]` independently, so fixing only the map would have left a
 * Lisbon traveler reading Bangkok's rooms.
 */
const KEY = 'samewhere.map.city.v1';

type CityChoiceState = {
  /** The chosen launch city id, or null when nothing was ever chosen. */
  cityId: number | null;
  /** True once the stored value (or its absence) has been read back. */
  hydrated: boolean;
  chooseCity: (cityId: number) => void;
};

export const useCityChoice = create<CityChoiceState>((set) => ({
  cityId: null,
  hydrated: false,
  chooseCity: (cityId) => {
    // The state first, storage best-effort after: a device that cannot write
    // simply forgets across restarts, which is the pre-store behaviour.
    set({ cityId, hydrated: true });
    AsyncStorage.setItem(KEY, String(cityId)).catch(() => {});
  },
}));

/**
 * Read the stored choice back. Runs once at module load; exported so tests
 * can await it deterministically. A choice made before the read lands wins
 * over the stale stored value it is about to replace.
 */
export async function hydrateCityChoice(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw != null ? Number(raw) : NaN;
    useCityChoice.setState((s) =>
      s.cityId != null
        ? { hydrated: true }
        : { cityId: Number.isFinite(parsed) ? parsed : null, hydrated: true }
    );
  } catch {
    // A device that cannot read simply starts unchosen.
    useCityChoice.setState({ hydrated: true });
  }
}

void hydrateCityChoice();
