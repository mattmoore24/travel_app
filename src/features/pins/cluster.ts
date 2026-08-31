import type { CityPinRow, PinCategory } from '@/lib/database.types';

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
 * How close two markers may sit ON SCREEN before they merge into one count
 * bubble. A fingertip: closer than this and the top marker owns both taps.
 */
export const SCREEN_CLUSTER_PT = 44;

/**
 * The screen pass's output: one or more venue clusters that would overlap at
 * the current zoom. `key` is the member pin ids sorted — NEVER the region —
 * so a bubble keeps its identity as the camera moves and markers do not
 * re-mount (and flash) on every pinch step.
 */
export type ScreenCluster = {
  key: string;
  lat: number;
  lng: number;
  members: PinCluster[];
};

/**
 * Second clustering pass, over clusterPins' output, in SCREEN space.
 *
 * The venue pass (30m) is right for its stated problem — two people at one
 * bar are one plan-site — but it knows nothing about zoom, so at a city-wide
 * delta two venues 400m apart overlap into one orange mass with one tap
 * target. This pass merges venue clusters whose on-screen separation is
 * under a fingertip into a plain count bubble; the bubble splits on tap by
 * zooming toward it. The venue pass stays untouched and separately tested.
 *
 * Same greedy seed-anchored shape as clusterPins, for the same reasons:
 * stable output for a given input, and O(n·k) on a set the k-anonymity rules
 * keep small.
 */
export function clusterByScreen(
  clusters: PinCluster[],
  region: { latitudeDelta: number; longitudeDelta: number } | null,
  screenWidth: number,
  screenHeight: number,
  thresholdPt = SCREEN_CLUSTER_PT
): ScreenCluster[] {
  const single = (cluster: PinCluster): ScreenCluster => ({
    key: cluster.key,
    lat: cluster.lat,
    lng: cluster.lng,
    members: [cluster],
  });
  if (region == null || screenWidth <= 0 || screenHeight <= 0) {
    return clusters.map(single);
  }
  // Each axis against its OWN screen dimension: latitudeDelta spans the
  // screen HEIGHT (~2.2x the width on a modern phone), so scaling it by the
  // width understated vertical separation and merged clearly-separate stacks.
  const points = (aLat: number, aLng: number, bLat: number, bLng: number) =>
    Math.max(
      (Math.abs(aLat - bLat) / region.latitudeDelta) * screenHeight,
      (Math.abs(aLng - bLng) / region.longitudeDelta) * screenWidth
    );

  const merged: ScreenCluster[] = [];
  // Sorted by key so the seeds — and therefore the output — cannot change
  // just because the venue pass returned the same clusters in another order.
  for (const cluster of [...clusters].sort((a, b) => a.key.localeCompare(b.key))) {
    const home = merged.find(
      (screen) => points(screen.lat, screen.lng, cluster.lat, cluster.lng) <= thresholdPt
    );
    if (home) {
      home.members.push(cluster);
    } else {
      merged.push(single(cluster));
    }
  }
  return merged.map((screen) =>
    screen.members.length === 1
      ? screen
      : {
          // Member ids sorted, not the seed's id: the same set of venues must
          // be the same bubble whichever of them seeded it.
          key: screen.members
            .map((member) => member.key)
            .sort()
            .join('|'),
          lat: screen.members.reduce((sum, member) => sum + member.lat, 0) / screen.members.length,
          lng: screen.members.reduce((sum, member) => sum + member.lng, 0) / screen.members.length,
          members: screen.members,
        }
  );
}

/** Every pin inside a screen cluster, for the bubble's count and category. */
export function screenClusterPins(screen: ScreenCluster): CityPinRow[] {
  return screen.members.flatMap((member) => member.pins);
}

/**
 * The category a stacked marker wears: the one its plans mostly agree on,
 * or 'mixed' when there is no clear winner. It used to be pins[0].category,
 * which dressed a bar-plus-hike stack as two bars — a lie about half the
 * stack.
 */
export function clusterCategory(cluster: PinCluster): PinCategory | 'mixed' {
  const counts = new Map<PinCategory, number>();
  for (const pin of cluster.pins) {
    counts.set(pin.category, (counts.get(pin.category) ?? 0) + 1);
  }
  let best: PinCategory | null = null;
  let bestCount = 0;
  let tied = false;
  for (const [category, count] of counts) {
    if (count > bestCount) {
      best = category;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }
  return best == null || tied ? 'mixed' : best;
}

/**
 * The soonest plan day in a cluster. A mixed-day stack dims (or not) by its
 * soonest day: the marker's job is "something is on here", and the soonest
 * plan is the something.
 */
export function clusterIntentDate(cluster: PinCluster): string {
  return cluster.pins.reduce(
    (soonest, pin) => (pin.intent_date < soonest ? pin.intent_date : soonest),
    cluster.pins[0].intent_date
  );
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
