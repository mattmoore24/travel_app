import type { QueryClient } from '@tanstack/react-query';

import {
  DISCOVERY_QUERY_KEYS,
  invalidateDiscoverySurfaces,
} from '@/features/profile/discovery-cache';

// Changing your audience left the native map on the previous one for up to a
// minute, because the invalidation named 'city-pins' (the web list) and never
// 'map-pins' (the map on a phone). Nothing caught it: the only visibility
// test mocks the whole hooks module, so that onSuccess body had never run in
// the suite at all.
//
// These assert the KEY STRINGS, which is exactly where the bug was, against
// the keys the screens really use.

describe('invalidateDiscoverySurfaces', () => {
  const fake = () => {
    const invalidateQueries = jest.fn();
    return {
      client: { invalidateQueries } as unknown as QueryClient,
      keys: () => invalidateQueries.mock.calls.map((c) => JSON.stringify(c[0].queryKey)),
    };
  };

  it('invalidates Travelers, the web pin list and the native map', () => {
    const { client, keys } = fake();
    invalidateDiscoverySurfaces(client);
    // useMatches -> ['matches', userId]; a bare prefix matches it.
    expect(keys()).toContain('["matches"]');
    // useCityPins -> ['city-pins', cityId]  (map-screen.web.tsx)
    expect(keys()).toContain('["city-pins"]');
    // useMapPins  -> ['map-pins', cityId, isGuest]  (map-screen.tsx). THE ONE
    // THAT WAS MISSING.
    expect(keys()).toContain('["map-pins"]');
  });

  it('leaves the heat layer alone, which is unfiltered to protect the k-threshold', () => {
    const { client, keys } = fake();
    invalidateDiscoverySurfaces(client);
    expect(keys()).not.toContain('["map-heat"]');
    expect(keys()).not.toContain('["heat-cells"]');
  });

  it('uses bare prefixes, since a caller does not know which city is on screen', () => {
    for (const key of DISCOVERY_QUERY_KEYS) {
      expect(key).toHaveLength(1);
    }
  });
});
