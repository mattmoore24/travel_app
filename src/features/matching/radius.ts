import { USES_MILES } from '@/lib/locale';

/**
 * How far from each of a traveler's trip cities the Travelers tab reaches.
 *
 * The founder: "allow users to see other travelers within a ~20 mile radius
 * of the city that they selected, similar to how Hinge does it ... users
 * should be able to decide what radius". Measured from the CENTRE of a city
 * the person typed - the same coordinate the map flies to - and never from a
 * device (§7 rule 2). The server holds the number (profiles.travelers_radius_km)
 * and applies it inside the policy that decides whether another trip can be
 * read at all, so this file only names the choices and says them out loud.
 *
 * Kilometres in storage, because the world measures that way and the table's
 * CHECK is in km; the phone's region decides which unit the PERSON reads.
 * The five steps are the ones that make sense of a coast: this city only,
 * the next town over, the twenty miles that put Monaco, Antibes and Cannes
 * on a Nice traveler's queue, a day trip, and a region.
 */
export const RADIUS_OPTIONS_KM = [0, 16, 32, 80, 160] as const;

export type RadiusKm = (typeof RADIUS_OPTIONS_KM)[number];

/** What a traveler who never touched the setting gets: about twenty miles. */
export const DEFAULT_RADIUS_KM: RadiusKm = 32;

const KM_PER_MILE = 1.609344;

/** The nearest option to a stored value, so an unexpected number still lights a row. */
export function nearestRadiusOption(km: number): RadiusKm {
  return RADIUS_OPTIONS_KM.reduce((best, option) =>
    Math.abs(option - km) < Math.abs(best - km) ? option : best
  );
}

/**
 * A distance the way this phone says one: '20 mi' or '32 km'. Whole numbers
 * only - a card is not a map legend - and never below one, because "0 mi"
 * for the next street over reads as a bug.
 */
export function distanceLabel(km: number, usesMiles = USES_MILES): string {
  if (usesMiles) {
    return `${Math.max(1, Math.round(km / KM_PER_MILE))} mi`;
  }
  return `${Math.max(1, Math.round(km))} km`;
}

/** The row's title in the picker: 'This city only', 'Within 20 miles'. */
export function radiusLabel(km: RadiusKm, usesMiles = USES_MILES): string {
  if (km === 0) {
    return 'This city only';
  }
  if (usesMiles) {
    return `Within ${Math.round(km / KM_PER_MILE)} miles`;
  }
  return `Within ${km} km`;
}

/** The row's second line: the same distance in the other unit, and an example. */
export function radiusDetail(km: RadiusKm, usesMiles = USES_MILES): string {
  const other = usesMiles ? `${km} km` : `${Math.round(km / KM_PER_MILE)} miles`;
  switch (km) {
    case 0:
      return 'Only travelers with a trip to the same city.';
    case 16:
      return `${other}. The next town over.`;
    case 32:
      return `${other}. Nice reaches Monaco, Antibes and Cannes.`;
    case 80:
      return `${other}. A day trip away.`;
    default:
      return `${other}. The whole coast.`;
  }
}

/** The chip on the Travelers tab: 'Within 20 mi', 'This city only'. */
export function radiusChipLabel(km: number, usesMiles = USES_MILES): string {
  if (km === 0) {
    return 'This city only';
  }
  return `Within ${distanceLabel(km, usesMiles)}`;
}
