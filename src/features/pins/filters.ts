import { filterDates, PIN_CATEGORIES } from '@/features/pins/pin-helpers';
import type { CityPinRow, PinCategory } from '@/lib/database.types';

/**
 * What the map is showing, as one object.
 *
 * The founder's words: "on the maps, the all, today, tomorrow filters are
 * confusing. You should instead just add a filters icon that takes users to a
 * different screen and select any type of filter they want."
 *
 * Three chips was not a filter system, it was one dimension of one — and the
 * one people asked about least. What a traveler actually wants to narrow is
 * WHO is on the map (other travelers, businesses, our own picks) and WHAT
 * they are doing, and neither was reachable at all.
 *
 * Everything here is derived from data the map already has: a pin carries its
 * category, whether it is one of ours, and whether the person is verified.
 * Nothing below asks the server for anything new.
 */

/** Which day's plans to show. A pin can never target more than two days out. */
export type DayFilter = 'any' | 'today' | 'tomorrow' | 'later';

/**
 * The three families of marker on the map, plus the heat layer. 'heat' is a
 * CLIENT-SIDE draw toggle only: it decides whether the already-thresholded
 * cells are painted, and must never become a parameter to the heat RPCs —
 * the k-threshold (§7 rule 6) is the server's alone.
 */
export type MarkerKind = 'travelers' | 'businesses' | 'picks' | 'heat';

export type MapFilters = {
  day: DayFilter;
  /** Which marker families to draw. Empty would be an empty map, so it is never allowed to empty. */
  kinds: MarkerKind[];
  /** Which plans to draw. EMPTY MEANS ALL — the natural reading of no boxes ticked. */
  categories: PinCategory[];
};

/**
 * There is deliberately no "verified travelers only" here.
 *
 * It was a second, weaker copy of the audience setting on the profile — that
 * one cuts BOTH ways and is enforced in the database by discovery_pair_ok, so
 * a narrowed audience is the real control and this was a client-side filter
 * that only narrowed what you saw. Two controls for one idea is how somebody
 * sets the map filter, believes they are hidden, and is not. Founder:
 * "you can also remove the 'verified only' option from the filters page as it
 * is already addressed with the filter in your profile."
 */

export const ALL_MARKER_KINDS: MarkerKind[] = ['travelers', 'businesses', 'picks', 'heat'];

export const DEFAULT_FILTERS: MapFilters = {
  day: 'any',
  kinds: ALL_MARKER_KINDS,
  categories: [],
};

/**
 * How many filters are ON, for the badge on the button.
 *
 * A number, not a dot: "3" tells somebody why the map looks emptier than they
 * expected and roughly how much to undo. Categories count as ONE however many
 * are ticked, because they are one decision.
 */
export function activeFilterCount(filters: MapFilters): number {
  let count = 0;
  if (filters.day !== 'any') {
    count += 1;
  }
  if (filters.kinds.length < ALL_MARKER_KINDS.length) {
    count += 1;
  }
  if (filters.categories.length > 0 && filters.categories.length < PIN_CATEGORIES.length) {
    count += 1;
  }
  return count;
}

export function isDefault(filters: MapFilters): boolean {
  return activeFilterCount(filters) === 0;
}

/**
 * Toggle one value in a list, without letting a group empty itself where an
 * empty group would mean something nobody chose.
 *
 * `atLeastOne` is for the marker families: unticking the last one leaves a map
 * with nothing on it, which reads as broken rather than as filtered.
 */
export function toggle<T>(list: T[], value: T, atLeastOne = false): T[] {
  if (!list.includes(value)) {
    return [...list, value];
  }
  if (atLeastOne && list.length === 1) {
    return list;
  }
  return list.filter((item) => item !== value);
}

/**
 * The intent dates a day filter accepts.
 *
 * Two of them, sometimes: `intent_date` is written by whichever clock the
 * sender was on, so a device just past midnight and a server just short of it
 * disagree about what "today" is. See filterDates.
 */
export function daysFor(
  day: DayFilter,
  now = new Date(),
  city: Date | null = null
): Set<string> | null {
  return day === 'any' ? null : new Set(filterDates(day, now, city));
}

/**
 * Which single day the heat RPC should be asked about — it takes one, or
 * none. With a city clock (cityClockNow) it is the CITY's day: filterDates
 * puts that candidate first.
 */
export function heatDay(day: DayFilter, now = new Date(), city: Date | null = null): string | null {
  return day === 'any' ? null : filterDates(day, now, city)[0];
}

/** Whether one traveler pin survives the current filters. */
export function pinPasses(pin: CityPinRow, filters: MapFilters, days: Set<string> | null): boolean {
  const kind: MarkerKind = pin.seeded ? 'picks' : 'travelers';
  if (!filters.kinds.includes(kind)) {
    return false;
  }
  if (days && !days.has(pin.intent_date)) {
    return false;
  }
  if (filters.categories.length > 0 && !filters.categories.includes(pin.category)) {
    return false;
  }
  // Nothing here tests `verified`. Who may see whom is settled server-side by
  // discovery_pair_ok before these rows ever reach the device, and it is
  // keyed to the pin's OWNER — a joiner on an open pin never removes the pin
  // from anybody's map, and never becomes visible through it.
  return true;
}

/** Whether business markers are drawn at all. There is nothing finer to ask yet. */
export function showsBusinesses(filters: MapFilters): boolean {
  return filters.kinds.includes('businesses');
}

/** Whether the heat layer is painted. Defaults on; client-side only. */
export function showsHeat(filters: MapFilters): boolean {
  return filters.kinds.includes('heat');
}

/**
 * How many markers survive the current filters — the number the filter
 * sheet prints. MUST be fed the same arrays the markers render (the pins
 * after pinPasses, the places the business toggle draws), or the number
 * contradicts the dots the moment Businesses is unticked.
 */
export function mapResultCount(
  filteredPinCount: number,
  placeCount: number,
  filters: MapFilters
): number {
  return filteredPinCount + (showsBusinesses(filters) ? placeCount : 0);
}
