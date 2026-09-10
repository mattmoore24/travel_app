import { PIN_CATEGORIES } from '@/features/pins/pin-helpers';
import { addDays, parseISODate, toISODate } from '@/features/trips/dates';
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
 * The WHEN came back on 2026-09-10, once a pin could stay up for a year:
 * with three days as the whole universe a day chip was decoration, and with
 * a year it is the difference between tonight and next spring. Founder:
 * "Let's start with anytime ... filters where the user can quickly pick
 * options within the next 7 days, next 30 days, or custom dates."
 *
 * Everything here is derived from data the map already has: a pin carries its
 * category, its day, whether it is one of ours, and whether the person is
 * verified. The only thing the server is asked for is the same date range
 * the markers are filtered by, so the counts and the payload agree.
 */

/**
 * Which days' plans to show. 'anytime' is the default and is expressed as an
 * ABSENCE everywhere (windowFor answers null, pinPasses skips the date test,
 * the range arguments are left off the RPCs) rather than as a wide range.
 */
export type WhenFilter = 'anytime' | 'next7' | 'next30' | 'custom';

/** An inclusive run of ISO days. */
export type DateWindow = { from: string; to: string };

/**
 * The three families of marker on the map, plus the heat layer. 'heat' is a
 * CLIENT-SIDE draw toggle only: it decides whether the already-thresholded
 * cells are painted, and must never become a parameter to the heat RPCs —
 * the k-threshold (§7 rule 6) is the server's alone.
 */
export type MarkerKind = 'travelers' | 'businesses' | 'picks' | 'heat';

/**
 * Flat keys, not a discriminated union: activeFilterCount, the camera key on
 * the map screen and its window memo all enumerate fields by hand.
 */
export type MapFilters = {
  when: WhenFilter;
  /** The picked range, read only under 'custom'. `to` is null mid-pick. */
  from: string | null;
  to: string | null;
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
  when: 'anytime',
  from: null,
  to: null,
  kinds: ALL_MARKER_KINDS,
  categories: [],
};

/**
 * How many filters are ON, for the badge on the button.
 *
 * A number, not a dot: "3" tells somebody why the map looks emptier than they
 * expected and roughly how much to undo. Categories count as ONE however many
 * are ticked, because they are one decision — and so is a date range, which
 * scores ONE for the `when` and nothing for the two days inside it.
 */
export function activeFilterCount(filters: MapFilters): number {
  let count = 0;
  if (filters.when !== 'anytime') {
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

/** Whole days from `a` to `b`, negative when `b` is earlier. */
function daysFromTo(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86_400_000);
}

/**
 * How far the device's and UTC's calendar days sit either side of the city's,
 * in whole days.
 *
 * Three clocks write `intent_date`. The pin form writes the browsed CITY's
 * calendar day (cityClockNow). Older pins carry the phone's LOCAL day
 * (features/trips/dates' toISODate, deliberately local because a trip is a
 * calendar range, not a timestamp). The curated seed writes Postgres's
 * `current_date`, which is UTC. An exact compare against the city's day
 * therefore hides a seeded plan from a traveler far enough east or west —
 * and this is a travel app, so "far enough" is the normal case. A founder at
 * UTC-7 at six in the evening is asking about a day the server rolled past
 * hours ago.
 *
 * Measured rather than a blanket one day each way, so the common case
 * (every clock on the same date) widens by nothing. `before` is how many days
 * the earliest of the three sits ahead of the city's; `after`, the latest.
 */
export function clockSkew(
  now = new Date(),
  city: Date | null = null
): { before: number; after: number } {
  const cityDay = city != null ? toISODate(city) : toISODate(now);
  const local = toISODate(now);
  const utc = now.toISOString().slice(0, 10);
  const offsets = [daysFromTo(cityDay, local), daysFromTo(cityDay, utc)];
  return {
    before: Math.max(0, -Math.min(...offsets)),
    after: Math.max(0, Math.max(...offsets)),
  };
}

/**
 * A window widened at BOTH ends by the measured skew: "widen, never swap".
 * The city's day leads and the other two clocks' days stay matched, so a
 * plan on a boundary day survives wherever the device is. The identical
 * widened pair goes to the client predicate and to the server parameters,
 * so the markers, the counts and the payload agree by construction.
 */
function widen(range: DateWindow, now: Date, city: Date | null): DateWindow {
  const skew = clockSkew(now, city);
  return {
    from: toISODate(addDays(parseISODate(range.from), -skew.before)),
    to: toISODate(addDays(parseISODate(range.to), skew.after)),
  };
}

/**
 * The days a `when` names, exactly as a person would say them and before any
 * clock tolerance: next7 and next30 are `[today, today + 6]` and
 * `[today, today + 29]` on the CITY's clock — the map is city-scoped, so a
 * traveler in Mexico City browsing Bangkok gets Bangkok's week — and custom
 * is the pair that was tapped, a single tapped day standing for one day.
 * Null for anytime, and for a custom range nobody has started picking.
 *
 * For PRINTING. windowFor is the same pair widened for matching; a sentence
 * that read the widened pair would name a day nobody picked.
 */
export function rangeFor(
  filters: MapFilters,
  now = new Date(),
  city: Date | null = null
): DateWindow | null {
  const clock = city ?? now;
  const today = toISODate(clock);
  switch (filters.when) {
    case 'anytime':
      return null;
    case 'next7':
      return { from: today, to: toISODate(addDays(clock, 6)) };
    case 'next30':
      return { from: today, to: toISODate(addDays(clock, 29)) };
    case 'custom':
      return filters.from != null ? { from: filters.from, to: filters.to ?? filters.from } : null;
  }
}

/**
 * The inclusive run of intent dates the current filters accept, or null for
 * every day — the one pair both the marker predicate and the two RPC calls
 * read. See rangeFor for the days themselves and widen for the tolerance.
 */
export function windowFor(
  filters: MapFilters,
  now = new Date(),
  city: Date | null = null
): DateWindow | null {
  const range = rangeFor(filters, now, city);
  return range == null ? null : widen(range, now, city);
}

/**
 * The city's today as a window, widened by the same skew — for the plan
 * list's "N today" peek, so the number it prints cannot disagree with the
 * markers the map draws for the same day.
 */
export function todayWindow(now = new Date(), city: Date | null = null): DateWindow {
  const today = toISODate(city ?? now);
  return widen({ from: today, to: today }, now, city);
}

/** Whether one intent date falls inside a window. ISO days compare as strings. */
export function inWindow(intentISO: string, window: DateWindow): boolean {
  return intentISO >= window.from && intentISO <= window.to;
}

/** Whether one traveler pin survives the current filters. */
export function pinPasses(
  pin: CityPinRow,
  filters: MapFilters,
  window: DateWindow | null
): boolean {
  const kind: MarkerKind = pin.seeded ? 'picks' : 'travelers';
  if (!filters.kinds.includes(kind)) {
    return false;
  }
  if (window && !inWindow(pin.intent_date, window)) {
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
