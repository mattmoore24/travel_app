import type { CityPinRow } from '@/lib/database.types';

/**
 * How close two pins have to be to become one marker. Roughly a building:
 * two people who both pinned the same bar are describing the same place, and
 * ought to look like it.
 */
export const CLUSTER_RADIUS_M = 30;

/**
 * Past this much latitude on screen (~65km), individual venues are smaller
 * than a fingertip and the map is really showing a city, not a street.
 */
export const CITY_ZOOM_DELTA = 0.6;

export type PinCluster = {
  key: string;
  lat: number;
  lng: number;
  pins: CityPinRow[];
};

export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * Merge pins that share a venue into one marker.
 *
 * Three plans at the same hostel used to render three markers within a few
 * pixels of each other: the top one covered the rest, so two of the three
 * were literally untappable, and the map said "one plan here" when it meant
 * three. At launch density — everybody pinning the same handful of bars in
 * the same handful of cities — that is the common case, not the edge one.
 *
 * Deliberately a simple greedy pass against cluster SEEDS rather than proper
 * agglomerative clustering: it is stable (same input, same output, no drift
 * as the map pans), it is O(n·k) on a set the k-anonymity rules already keep
 * small, and the failure mode of a greedy pass — two pins 31m apart landing
 * in different clusters — is invisible on a map at this zoom.
 */
export function clusterPins(pins: CityPinRow[], radiusM = CLUSTER_RADIUS_M): PinCluster[] {
  const clusters: PinCluster[] = [];
  // Sorted by id so the seed order — and therefore the output — cannot
  // change just because the server returned the same rows in another order.
  for (const pin of [...pins].sort((a, b) => a.id.localeCompare(b.id))) {
    const home = clusters.find(
      (cluster) => metersBetween(cluster.lat, cluster.lng, pin.lat, pin.lng) <= radiusM
    );
    if (home) {
      home.pins.push(pin);
    } else {
      clusters.push({ key: pin.id, lat: pin.lat, lng: pin.lng, pins: [pin] });
    }
  }
  return clusters;
}

/** The label a stacked marker carries. Two faces plus "+3", not "5". */
export function stackLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}

/**
 * What a stacked marker says when it opens: the venue if everybody agrees on
 * one, the count otherwise.
 */
export function clusterTitle(cluster: PinCluster): string {
  const names = new Set(cluster.pins.map((pin) => pin.venue_name));
  if (names.size === 1) {
    return cluster.pins[0].venue_name;
  }
  return `${cluster.pins.length} plans here`;
}
