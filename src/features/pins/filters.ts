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

/** The three families of marker on the map. */
export type MarkerKind = 'travelers' | 'businesses' | 'picks';

export type MapFilters = {
  day: DayFilter;
  /** Which marker families to draw. Empty would be an empty map, so it is never allowed to empty. */
  kinds: MarkerKind[];
  /** Which plans to draw. EMPTY MEANS ALL — the natural reading of no boxes ticked. */
  categories: PinCategory[];
  /** Only plans from travelers who have passed the selfie check. */
  verifiedOnly: boolean;
};

export const ALL_MARKER_KINDS: MarkerKind[] = ['travelers', 'businesses', 'picks'];

export const DEFAULT_FILTERS: MapFilters = {
  day: 'any',
  kinds: ALL_MARKER_KINDS,
  categories: [],
  verifiedOnly: false,
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
  if (filters.verifiedOnly) {
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
export function daysFor(day: DayFilter, now = new Date()): Set<string> | null {
  return day === 'any' ? null : new Set(filterDates(day, now));
}

/** Which single day the heat RPC should be asked about — it takes one, or none. */
export function heatDay(day: DayFilter, now = new Date()): string | null {
  return day === 'any' ? null : filterDates(day, now)[0];
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
  // One of our picks has no person behind it, so "only verified travelers"
  // cannot be true or false of it. It is not a traveler, and the filter is
  // about travelers — asking it to prove a badge it can never hold would
  // silently empty a map that somebody only meant to narrow.
  if (filters.verifiedOnly && !pin.seeded && !pin.verified) {
    return false;
  }
  return true;
}

/** Whether business markers are drawn at all. There is nothing finer to ask yet. */
export function showsBusinesses(filters: MapFilters): boolean {
  return filters.kinds.includes('businesses');
}
