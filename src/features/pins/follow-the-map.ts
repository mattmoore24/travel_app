import { metersBetween } from '@/features/pins/cluster';

/**
 * The map follows the pan.
 *
 * Founder, 2026-09-11: "I should also just be able to pan around on the map
 * and find any city without directly searching it, similar to how you can
 * on Zillow." The map is city-scoped (every feed reads from the browsed
 * city's centre), so following the pan means changing the browsed city to
 * wherever the map has settled, and that is all it means: the camera stays
 * where the person put it, the search bar names the new city, and the
 * plans, businesses and heat for it load underneath.
 *
 * Two gates, both here so they can be tested without a map. Nothing follows
 * past city scale, because a centre at country zoom names nothing. And
 * nothing is even asked until the centre is FOLLOW_MIN_KM from the browsed
 * city's own centre, which is the resolver's own rule (city_for_spot keeps
 * its hint city within 20 km, validate_pin's radius), so an ask inside it
 * could only ever answer with the city already on screen.
 *
 * What the ask answers with past that is population-weighted (nearest_city
 * ranks by distance over the fourth root of population), so a pan across a
 * metro's suburbs keeps naming the metro, and a pan to another city names
 * that one. Never a device position: the centre is where the person
 * dragged the map to (§7 rule 2 has a client half too).
 */
export const FOLLOW_MIN_KM = 20;

/**
 * How long a settled region has to hold before the resolver is asked. A
 * flick across a country settles many times on the way; one call for the
 * last centre is enough.
 */
export const FOLLOW_SETTLE_MS = 700;

export function shouldFollowMap(
  centre: { latitude: number; longitude: number },
  city: { lat: number; lng: number } | null,
  cityScale: boolean
): boolean {
  if (city == null || cityScale) {
    return false;
  }
  return (
    metersBetween(centre.latitude, centre.longitude, city.lat, city.lng) > FOLLOW_MIN_KM * 1000
  );
}
