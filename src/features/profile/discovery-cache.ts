import type { QueryClient } from '@tanstack/react-query';

/**
 * Every cached query whose contents depend on `discovery_pair_ok`.
 *
 * A list rather than three calls at a call site, because the call site got it
 * wrong: `useSetVisibility` invalidated `['city-pins']` and not `['map-pins']`,
 * and those are two different cache families feeding two different maps (the
 * web list and the native map). On a phone the invalidation therefore matched
 * nothing, and the map kept showing the previous audience until its
 * sixty-second poll came round.
 *
 * `useCreatePin` already knew: "Missing the second pair meant a posted pin
 * never appeared until app restart" (features/pins/hooks.ts). This is the
 * same trap, so the answer lives in one place now.
 *
 * Bare prefixes: the keys carry a city id and a caller changing their own
 * audience has no idea which city is on screen.
 */
export const DISCOVERY_QUERY_KEYS = [
  // Travelers.
  ['matches'],
  // The web pin list.
  ['city-pins'],
  // The native map.
  ['map-pins'],
] as const;

/**
 * Deliberately absent: the heat layer.
 *
 * `discovery_pair_ok` appears in get_matches, city_pins and featured_traveler
 * and nowhere near heat_cells. The heatmap is unfiltered on purpose so the
 * k-threshold holds (PRODUCT_BRIEF §7 rule 6) - re-filtering per viewer would
 * LOWER a cell's count for some viewers, which is the direction that breaks
 * the guarantee. Invalidating it would buy a refetch of identical rows.
 */
export function invalidateDiscoverySurfaces(queryClient: QueryClient) {
  for (const queryKey of DISCOVERY_QUERY_KEYS) {
    queryClient.invalidateQueries({ queryKey });
  }
}
