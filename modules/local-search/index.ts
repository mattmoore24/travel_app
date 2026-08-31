import { requireOptionalNativeModule } from 'expo-modules-core';

export type LocalSearchResult = {
  name: string;
  /** Street line, when MapKit has one. */
  address: string | null;
  /** Neighbourhood or city, for telling two identical names apart. */
  locality: string | null;
  latitude: number;
  longitude: number;
  /** MKPointOfInterestCategory raw value, e.g. "MKPOICategoryCafe". */
  category: string | null;
};

type LocalSearchNativeModule = {
  searchAsync: (
    query: string,
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number
  ) => Promise<LocalSearchResult[]>;
  /**
   * OPTIONAL on the METHOD, not just the module. The module shipped in an
   * earlier binary, so on the founder's current TestFlight build
   * `requireOptionalNativeModule` returns the module — with searchAsync and
   * nothing else. An over-the-air bundle that assumed the method would crash
   * exactly there. Presence has to be checked per method; see nearbyPlaces.
   */
  nearbyAsync?: (
    latitude: number,
    longitude: number,
    radiusMeters: number,
    limit: number
  ) => Promise<LocalSearchResult[]>;
};

// OPTIONAL on purpose. This app ships JavaScript over the air to binaries
// that were built before this module existed, and `requireOptionalNativeModule`
// returns null there instead of throwing (verified in
// expo-modules-core/src/requireNativeModule.ts). Every caller must treat
// absence as "fall back to address geocoding", never as an error.
const LocalSearch = requireOptionalNativeModule<LocalSearchNativeModule>('LocalSearch');

/** True once a build containing the module is installed (iOS only). */
export const venueSearchAvailable = LocalSearch != null;

/**
 * True once a build containing nearbyAsync is installed. Checked per METHOD:
 * binaries older than the method still carry the module, so
 * `venueSearchAvailable` alone would send them a call that throws.
 */
export const nearbySearchAvailable = typeof LocalSearch?.nearbyAsync === 'function';

/**
 * Places Apple Maps knows about, near a city centre. Returns an empty list
 * for no matches, and throws only on a genuine search failure.
 */
export async function searchPlaces(input: {
  query: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  limit?: number;
}): Promise<LocalSearchResult[]> {
  if (!LocalSearch) {
    return [];
  }
  return LocalSearch.searchAsync(
    input.query,
    input.latitude,
    input.longitude,
    input.radiusMeters ?? 30_000,
    input.limit ?? 8
  );
}

/**
 * The venues at a coordinate, with no query — what sits under the placement
 * pin. Empty on a binary without the method (an OTA bundle can reach one),
 * empty where MapKit knows nothing (open water, sparse regions), and the
 * chip row it feeds must be absent rather than empty in both cases.
 *
 * The coordinate is the map centre the person chose, never a device
 * location (§7 rule 2: no location permission exists anywhere near this).
 */
export async function nearbyPlaces(input: {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  limit?: number;
}): Promise<LocalSearchResult[]> {
  if (!LocalSearch || typeof LocalSearch.nearbyAsync !== 'function') {
    return [];
  }
  return LocalSearch.nearbyAsync(
    input.latitude,
    input.longitude,
    input.radiusMeters ?? 120,
    input.limit ?? 6
  );
}
