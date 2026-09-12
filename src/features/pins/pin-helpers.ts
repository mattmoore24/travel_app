import { cityNow, shortTime } from '@/features/business/vocabulary';
import { metersBetween } from '@/features/pins/cluster';
import { addDays, formatDate, parseISODate, toISODate } from '@/features/trips/dates';
import type { CityPinRow, PinCategory } from '@/lib/database.types';
import { dates } from '@/lib/locale';

/**
 * The two columns 20260902190000 added to both map feeds.
 *
 * Declared here rather than on CityPinRow because src/lib/database.types.ts
 * is not this package's file. Fold them into the row type when it is; every
 * helper below takes them as OPTIONAL, so a plain CityPinRow still passes and
 * nothing has to be cast at a call site in the meantime.
 */
export type PinExtras = {
  /** Postgres `time` as 'HH:MM:SS'. Null means "sometime that day". */
  intent_time?: string | null;
  /** The end of the window; at or before the start means past midnight. */
  intent_time_end?: string | null;
  /** The author said the time is to be decided: an answer, not silence. */
  time_tbd?: boolean;
  /** The listed business this plan is at, when the two are the same place. */
  business_id?: string | null;
};

/** A pin as the map actually receives it today. */
export type MapPin = CityPinRow & PinExtras;

/**
 * ONE answer to "what is this pin called", wherever it is met. The card, the
 * cluster row and the hero used to each decide for themselves, so tapping a
 * stack, reading a row and opening the card gave two names for one object.
 * The title is the venue; the subtitle is the plan, when there is one. If
 * the venue/plan column split ever changes the definition, it changes here.
 */
export function pinTitle(pin: { venue_name: string }): string {
  return pin.venue_name;
}

/**
 * The plan text, or null when there is none worth showing. `plan` is the
 * column that means it since the venue/plan split; `note` (the
 * finding-the-door detail) stands in for rows that predate the split and
 * for plans whose author wrote only a detail.
 */
export function pinSubtitle(pin: { plan?: string | null; note: string | null }): string | null {
  const plan = pin.plan?.trim();
  if (plan) {
    return plan;
  }
  const note = pin.note?.trim();
  return note ? note : null;
}

// No emoji field, deliberately: every surface that shows a category draws
// the marker's own glyph (PinGlyph), so the picker and the map share one
// vocabulary. The emoji labels contradicted the map's glyphs twice and put
// a red pushpin on screen; the reasoning is written out in pin-marker.tsx.
export const PIN_CATEGORIES: { value: PinCategory; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'restaurant', label: 'Food' },
  { value: 'club', label: 'Club' },
  { value: 'museum', label: 'Museum' },
  { value: 'monument', label: 'Sights' },
  { value: 'beach', label: 'Beach' },
  { value: 'hike', label: 'Hike' },
  { value: 'other', label: 'Other' },
];

/**
 * The furthest out a pin can be set to disappear, in days from the city's
 * today. The trigger ceilings take_down_on at today + 366, one looser than
 * this, so a form that offers exactly this can never post a day the server
 * refuses. Founder, 2026-09-10: "the traveler can select the date that the
 * pin will be active until, with a maximum of one year, regardless of what
 * trips they have planned."
 */
export const MAX_TAKE_DOWN_DAYS = 365;

/**
 * The first and last day a pin may disappear on, on the CITY's clock: its
 * today, and a year out. Both calendars in the pin form and the map's date
 * filter take these two bounds from here, so the filter can never ask for
 * a day a pin could not occupy.
 */
export function takeDownBounds(cityClock: Date): { minISO: string; maxISO: string } {
  return {
    minISO: toISODate(cityClock),
    maxISO: toISODate(addDays(cityClock, MAX_TAKE_DOWN_DAYS)),
  };
}

/**
 * The day a pin disappears, as the form will post it.
 *
 * Nothing picked means the plan's own day, which is what "I want to go
 * there Friday" has always meant. A picked day is kept as picked, floored at
 * the city's today (a sheet left open across midnight cannot post a dead
 * day) and ceilinged a year out. There is deliberately NO floor at the
 * plan's day: a take-down before the plan is legal and ordinary. Founder,
 * 2026-09-10: "people should be able to have a pin active until a date
 * before the actual plans as sometimes people may be trying to plan
 * something in advance and not want people to be able to message about it
 * all the way up until the event." The form draws one calm line about it
 * and nothing else.
 */
export function effectiveTakeDown(
  picked: string | null,
  intentISO: string,
  cityClock: Date
): string {
  const { minISO, maxISO } = takeDownBounds(cityClock);
  const wanted = picked ?? intentISO;
  if (wanted < minISO) {
    return minISO;
  }
  if (wanted > maxISO) {
    return maxISO;
  }
  return wanted;
}

/**
 * Apple's point-of-interest categories, folded onto the eight kinds a pin
 * can be. This exists because the "what kind of plan" chips are gone: the
 * founder's note was that nobody should have to answer a question the map
 * already knows the answer to. Anything unrecognised is 'other', which is a
 * real answer rather than a failure.
 *
 * Matching is on the raw value's tail ("MKPOICategoryNightlife" -> nightlife)
 * so it survives Apple adding a prefix or changing case.
 */
export function categoryForPoi(raw: string | null | undefined): PinCategory {
  if (!raw) {
    return 'other';
  }
  const key = raw.replace(/^MKPOICategory/i, '').toLowerCase();
  const table: Record<string, PinCategory> = {
    brewery: 'bar',
    winery: 'bar',
    nightlife: 'club',
    cafe: 'restaurant',
    bakery: 'restaurant',
    restaurant: 'restaurant',
    foodmarket: 'restaurant',
    museum: 'museum',
    aquarium: 'museum',
    planetarium: 'museum',
    zoo: 'museum',
    library: 'museum',
    theater: 'museum',
    movietheater: 'museum',
    musicvenue: 'club',
    landmark: 'monument',
    nationalmonument: 'monument',
    castle: 'monument',
    fortress: 'monument',
    beach: 'beach',
    marina: 'beach',
    surfing: 'beach',
    swimming: 'beach',
    hiking: 'hike',
    nationalpark: 'hike',
    park: 'hike',
    campground: 'hike',
    fishing: 'hike',
    kayaking: 'hike',
    skating: 'hike',
    skiing: 'hike',
  };
  if (table[key]) {
    return table[key];
  }
  // A couple of families are easier to catch by shape than to enumerate.
  if (key.includes('bar') || key.includes('pub')) {
    return 'bar';
  }
  if (key.includes('food') || key.includes('restaurant')) {
    return 'restaurant';
  }
  return 'other';
}

// Small and unambiguous on purpose (founder decision D10: no chip rail —
// fix the inference). Each word names an activity a person would write in a
// plan; anything needing a second thought belongs in the nearby-venue
// lookup, which carries a real POI category. "walk" -> hike is the
// borderline this list stops at. First hit wins, in this order.
const PLAN_KEYWORDS: [PinCategory, string[]][] = [
  ['bar', ['drinks', 'beer', 'pub', 'cocktail', 'rooftop']],
  ['restaurant', ['dinner', 'lunch', 'breakfast', 'food', 'eat', 'brunch', 'coffee']],
  ['club', ['club', 'dancing', 'party', 'gig']],
  ['hike', ['hike', 'trek', 'walk', 'park']],
  ['beach', ['beach', 'surf', 'swim']],
  ['museum', ['museum', 'gallery', 'exhibition']],
  ['monument', ['temple', 'wat', 'palace', 'ruins']],
];

/**
 * A guess at the pin's kind from the plan's own words, for the hand-placed
 * path where the map supplied no POI. "Sunset drinks" is a bar pin; without
 * this it filed as 'other' and vanished under every category filter.
 *
 * Null — not 'other' — when no keyword matches, so the caller decides:
 * categoryForPoi's rule that unrecognised is a real answer (the comment
 * above it records the founder's ruling) is extended here, not replaced.
 * The guess is never invisible: the form's place card draws the marker
 * live as the plan is typed, so the person sees the pin they are about to
 * drop before they drop it.
 */
export function categoryForPlan(text: string): PinCategory | null {
  const plan = text.toLowerCase();
  for (const [category, words] of PLAN_KEYWORDS) {
    if (words.some((word) => new RegExp(`\\b${word}\\b`).test(plan))) {
      return category;
    }
  }
  return null;
}

/**
 * What is left of a pin: an hours countdown on its last day, and the day it
 * disappears before that.
 *
 * The day is printed from the pin's own `take_down_on`, never by converting
 * `expires_at` into the reader's timezone: the expiry is midnight at the end
 * of that day in the CITY's clock, and a reader far enough east or west
 * would see it land on the wrong date. A row shape that carries no
 * take_down_on (pin_for_group, the room's card) passes the day
 * takeDownDayFor reads off the expiry in the city's own clock instead.
 */
export function takeDownLabel(takeDownISO: string, expiresAtISO: string, now = new Date()): string {
  const msLeft = new Date(expiresAtISO).getTime() - now.getTime();
  if (msLeft < 3_600_000) {
    return 'disappears soon';
  }
  if (msLeft < 24 * 3_600_000) {
    // Rounded, not floored. Flooring made a pin posted for 23 hours announce
    // "disappears in 22h" on the very next screen, which reads as the app
    // quietly taking an hour off you.
    return `disappears in ${Math.round(msLeft / 3_600_000)}h`;
  }
  return `up until ${formatDate(takeDownISO)}`;
}

/**
 * The calendar day a pin disappears, read off its expiry in the city's own
 * clock, for the one row shape that carries no take_down_on: pin_for_group.
 *
 * The expiry is midnight at the END of that day in the city's zone, so the
 * instant twelve hours before it is the middle of the take-down day there.
 * Twelve hours rather than one minute because the clock here is cityNow's
 * longitude approximation, which can sit an hour or two off the real zone;
 * noon is far enough from either midnight to survive that.
 */
export function takeDownDayFor(expiresAtISO: string, lng: number | null): string {
  const midday = new Date(new Date(expiresAtISO).getTime() - 12 * 3_600_000);
  return toISODate(cityNow(midday, lng));
}

/**
 * '19:00', or '7:00 PM'. Null for a plan that never named an hour, which is
 * a real answer and not a missing one.
 *
 * Goes through lib/locale's single clock (business/vocabulary's shortTime is
 * its wall-clock caller), because the app prints an hour from exactly one
 * place and src/lib/__tests__/one-clock.test.ts fails otherwise.
 */
export function intentTimeLabel(time: string | null | undefined): string | null {
  if (!time) {
    return null;
  }
  return shortTime(time);
}

/**
 * The time part of a plan, or null for one that never named an hour:
 * '19:00', '19:00 to 22:00', or 'time TBD'.
 *
 * Four honest shapes and no fifth. Silence (no hour) prints nothing, because
 * "sometime that day" is what the day already says; TBD prints, because the
 * author is telling the reader to ask rather than to assume.
 */
export function timeWindowLabel(pin: PinExtras): string | null {
  if (pin.time_tbd) {
    return 'time TBD';
  }
  const start = intentTimeLabel(pin.intent_time);
  if (!start) {
    return null;
  }
  const end = intentTimeLabel(pin.intent_time_end);
  return end ? `${start} to ${end}` : start;
}

/**
 * When a plan is, in one line: 'Today', 'Today at 19:00', 'Today, 19:00 to
 * 22:00', or 'Today, time TBD'.
 *
 * "at" and never "here": an hour on a pin is future intent exactly like the
 * date beside it, and the app does not make presence claims (§7 rule 2).
 */
export function whenLabel(pin: { intent_date: string } & PinExtras, now = new Date()): string {
  const day = intentLabel(pin.intent_date, now);
  if (pin.time_tbd) {
    return `${day}, time TBD`;
  }
  const start = intentTimeLabel(pin.intent_time);
  if (!start) {
    return day;
  }
  const end = intentTimeLabel(pin.intent_time_end);
  return end ? `${day}, ${start} to ${end}` : `${day} at ${start}`;
}

/**
 * Earliest plan first, and a plan with no hour sits after the ones that named
 * one for the same day. The server already orders both map feeds this way;
 * this is the client's copy of the same rule, for the lists it builds itself
 * out of clustered rows.
 */
export function byIntentMoment(
  a: { intent_date: string } & PinExtras,
  b: { intent_date: string } & PinExtras
): number {
  if (a.intent_date !== b.intent_date) {
    return a.intent_date < b.intent_date ? -1 : 1;
  }
  const left = a.intent_time ?? null;
  const right = b.intent_time ?? null;
  if (left === right) {
    return 0;
  }
  if (left == null) {
    return 1;
  }
  if (right == null) {
    return -1;
  }
  return left < right ? -1 : 1;
}

/** The form's "I have not said". Empty, so it is falsy on submit. */
export const NO_INTENT_TIME = '';

/**
 * "Today" / "Tomorrow" / "Friday, Sep 18" for a pin's intent date, and
 * "Sep 18, 2027" once the year is not the current one: the rule formatDate
 * (features/trips/dates) already follows. A pin can be up for a year now, so
 * a plan eleven months out must not render as an unqualified weekday.
 */
export function intentLabel(intentISO: string, now = new Date()): string {
  const today = toISODate(now);
  if (intentISO === today) {
    return 'Today';
  }
  if (intentISO === toISODate(addDays(now, 1))) {
    return 'Tomorrow';
  }
  const day = parseISODate(intentISO);
  return day.getFullYear() === now.getFullYear()
    ? dates().weekdayLongMonthDay.format(day)
    : dates().monthDayYear.format(day);
}

/**
 * The browsed city's wall clock, as a Date whose LOCAL getters read the
 * city's own time — the shape cityNow already hands to the business-hours
 * code, so both halves of the app tell time the same way.
 *
 * The map is city-scoped and its stated use case is planning a city you have
 * not reached yet, so "today" on it means the CITY's today: at 20:00 in
 * London it is 03:00 the NEXT day in Bangkok, and a device-clock "today"
 * filters to a night that ended hours ago. Prefers the real IANA zone
 * (launch_cities.timezone); falls back to cityNow's longitude approximation
 * when the zone is missing or unknown to this device's ICU.
 */
export function cityClockNow(timezone: string | null, lng: number | null, now = new Date()): Date {
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(now);
      const num = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
      const year = num('year');
      const month = num('month');
      const day = num('day');
      // Some ICU builds print midnight as '24' under hour12: false.
      const hour = num('hour') % 24;
      const minute = num('minute');
      const second = num('second');
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return new Date(year, month - 1, day, hour, minute, second);
      }
    } catch {
      // An IANA name this device's ICU does not know: fall through.
    }
  }
  return cityNow(now, lng);
}

/** iOS CLGeocoder rate-limits: never reverse-geocode more often than this. */
export const GEOCODE_FLOOR_MS = 800;

/** Closer than this to the last geocoded centre is the same answer. */
export const GEOCODE_MIN_MOVE_M = 15;

/**
 * Whether the place-mode pill may ask CLGeocoder to name the map's centre.
 *
 * Two refusals, both because iOS rate-limits reverse geocoding and starts
 * returning errors under rapid panning: a hard floor since the last call,
 * and a skip when the map has barely moved (the answer would be the same
 * street). Pure, so the throttling is unit-testable instead of living
 * inside a map callback.
 */
export function shouldGeocode({
  last,
  next,
  lastAtMs,
  nowMs,
}: {
  last: { lat: number; lng: number } | null;
  next: { lat: number; lng: number };
  lastAtMs: number;
  nowMs: number;
}): boolean {
  if (nowMs - lastAtMs < GEOCODE_FLOOR_MS) {
    return false;
  }
  if (last != null && metersBetween(last.lat, last.lng, next.lat, next.lng) < GEOCODE_MIN_MOVE_M) {
    return false;
  }
  return true;
}

/**
 * Whether a plan is for a LATER day than today, on either of the two clocks
 * that write intent_date (the device's local day and Postgres's UTC
 * `current_date`; features/pins/filters' clockSkew is the same tolerance
 * for the map). Markers burn a step dimmer for later days; today, and a day
 * already under way, burn at full amber. ISO date strings compare correctly
 * as strings.
 */
export function isLaterDay(intentISO: string, now = new Date()): boolean {
  return intentISO > toISODate(now) && intentISO > now.toISOString().slice(0, 10);
}

/**
 * The city-clock variant of the dim, for callers holding the SYNTHETIC Date
 * cityClockNow returns. isLaterDay's second leg is UTC-write tolerance for
 * the DEVICE clock, and it is meaningless on a synthetic Date: its
 * toISOString() re-reads the city's wall time in the device's own zone.
 * Browsing Bangkok at 20:00 Bangkok time from Mexico City (UTC-6), the
 * synthetic clock's instant is already 02:00Z on Bangkok's TOMORROW, so a
 * pin for that tomorrow failed `intentISO > toISOString()` and lost its
 * dim. On a city clock the city's calendar day is the whole question.
 */
export function isLaterCityDay(intentISO: string, clock: Date): boolean {
  return intentISO > toISODate(clock);
}
