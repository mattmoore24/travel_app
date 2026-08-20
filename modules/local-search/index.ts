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
