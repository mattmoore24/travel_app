import { cityNow, shortTime } from '@/features/business/vocabulary';
import { metersBetween } from '@/features/pins/cluster';
import { addDays, parseISODate, toISODate } from '@/features/trips/dates';
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

export const MAX_PIN_HOURS = 72;

// The DB CHECK compares expires_at to the SERVER clock; a device even
// seconds ahead would fail an exactly-72h expiry, so stay safely inside.
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

function maxExpiry(now: Date): Date {
  return new Date(now.getTime() + MAX_PIN_HOURS * 3_600_000 - SAFETY_MARGIN_MS);
}

/** The three days a pin's intent can target (bounded by the 72h lifetime). */
export function intentDateOptions(now = new Date()): { value: string; label: string }[] {
  return [0, 1, 2].map((offset) => {
    const date = addDays(now, offset);
    const label =
      offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : dates().weekdayLong.format(date);
    return { value: toISODate(date), label };
  });
}

/**
 * A pin lives until the END of its intent day (the product default: "I want
 * to go there Friday" stops mattering Saturday), hard-capped at 72h from now.
 */
export function expiryForIntentDate(intentISO: string, now = new Date()): Date {
  const endOfIntentDay = addDays(parseISODate(intentISO), 1); // local midnight after
  const cap = maxExpiry(now);
  return endOfIntentDay < cap ? endOfIntentDay : cap;
}

export type PinDuration = 'end_of_day' | '24h' | '48h' | '72h';

export const DURATION_OPTIONS: { value: PinDuration; label: string }[] = [
  { value: 'end_of_day', label: 'End of that day' },
  { value: '24h', label: '24h' },
  { value: '48h', label: '48h' },
  { value: '72h', label: '72h' },
];

/** Brief §1: "a pin persists for a user-set duration, maximum 72 hours". */
export function expiryForDuration(
  duration: PinDuration,
  intentISO: string,
  now = new Date()
): Date {
  if (duration === 'end_of_day') {
    return expiryForIntentDate(intentISO, now);
  }
  const hours = Number(duration.replace('h', ''));
  const raw = new Date(now.getTime() + Math.min(hours, MAX_PIN_HOURS) * 3_600_000);
  const cap = maxExpiry(now);
  return raw < cap ? raw : cap;
}

/**
 * Durations that keep the pin alive into its intent day — "Monday" with a
 * 24h lifetime that dies Sunday is incoherent and is filtered out here.
 */
export function validDurations(intentISO: string, now = new Date()): PinDuration[] {
  const intentDayStart = parseISODate(intentISO);
  return DURATION_OPTIONS.filter(
    (option) => expiryForDuration(option.value, intentISO, now) > intentDayStart
  ).map((option) => option.value);
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

/** The narrowest a pin's life can be set to. */
export const MIN_PIN_HOURS = 1;

/** Expiry for a plain "this many hours from now", capped by the 72h rule. */
export function expiryForHours(hours: number, now = new Date()): Date {
  const wanted = Math.min(Math.max(Math.round(hours), MIN_PIN_HOURS), MAX_PIN_HOURS);
  const raw = new Date(now.getTime() + wanted * 3_600_000);
  const cap = maxExpiry(now);
  return raw < cap ? raw : cap;
}

/**
 * The fewest hours that still reach the plan's own day. Setting a pin for
 * Friday and having it vanish on Thursday night is incoherent, so the
 * slider starts here rather than at one.
 */
export function minHoursForIntent(intentISO: string, now = new Date()): number {
  const intentDayStart = parseISODate(intentISO);
  const hoursAway = Math.ceil((intentDayStart.getTime() - now.getTime()) / 3_600_000);
  return Math.min(Math.max(hoursAway + 1, MIN_PIN_HOURS), MAX_PIN_HOURS);
}

/**
 * A plan posted at eleven at night is not a one-hour plan.
 *
 * The default is the end of the plan's day, which is right at six in the
 * evening and absurd at eleven: the pin came off the map before anybody had
 * left the hostel. A night out does not end at midnight, so the default has a
 * floor under it. Anyone who genuinely wants an hour can still drag the
 * slider down to one.
 */
const DEFAULT_FLOOR_HOURS = 6;

/** Where the slider sits before anyone touches it: the end of the plan's day. */
export function defaultHoursForIntent(intentISO: string, now = new Date()): number {
  const endOfDay = expiryForIntentDate(intentISO, now);
  const hours = Math.round((endOfDay.getTime() - now.getTime()) / 3_600_000);
  return Math.min(
    Math.max(hours, minHoursForIntent(intentISO, now), DEFAULT_FLOOR_HOURS),
    MAX_PIN_HOURS
  );
}

/** "1 hour" / "6 hours" / "2 days" — a duration a person would say out loud. */
export function hoursLabel(hours: number): string {
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const dayPart = `${days} day${days === 1 ? '' : 's'}`;
  return rest === 0 ? dayPart : `${dayPart} ${rest}h`;
}

/**
 * Campfire-voiced countdown for the ≤72h pin lifetime — the expiry is the
 * product's heartbeat, so it's worth saying out loud on every pin.
 */
export function burnOutLabel(expiresAtISO: string, now = new Date()): string {
  const msLeft = new Date(expiresAtISO).getTime() - now.getTime();
  if (msLeft < 3_600_000) {
    return 'burns out soon';
  }
  // Rounded, not floored. Flooring made a pin posted for 23 hours announce
  // "burns out in 22h" on the very next screen, which reads as the app
  // quietly taking an hour off you.
  return `burns out in ${Math.round(msLeft / 3_600_000)}h`;
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
 * When a plan is, in one line: 'Today', or 'Today at 19:00'.
 *
 * "at" and never "here": an hour on a pin is future intent exactly like the
 * date beside it, and the app does not make presence claims (§7 rule 2).
 */
export function whenLabel(pin: { intent_date: string } & PinExtras, now = new Date()): string {
  const day = intentLabel(pin.intent_date, now);
  const at = intentTimeLabel(pin.intent_time);
  return at ? `${day} at ${at}` : day;
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

/** The chip that means "I have not said". Empty, so it is falsy on submit. */
export const NO_INTENT_TIME = '';

/**
 * The hours a pin may actually name, and no others.
 *
 * Two refusals, and between them they are why an optional hour cannot become
 * a way around the 72-hour ceiling (§7 rule 3). An hour already gone on the
 * CITY's clock is not a plan, and an hour that falls after the pin's own
 * expiry is a plan the map would advertise past the moment it goes dark. The
 * database refuses that second one outright (validate_pin resolves the
 * intent moment in the city's zone and compares it to expires_at), so this
 * is the same rule stated where a person can see it rather than a form that
 * offers a choice the server will reject.
 *
 * The offset between the two clocks is the difference between the city's
 * wall time and this device's: cityClockNow hands back a Date whose LOCAL
 * getters read the city's hour, so subtracting is exactly that gap.
 */
export function intentTimeOptions(
  intentISO: string,
  expiresAt: Date,
  cityClock: Date,
  now = new Date()
): { value: string; label: string }[] {
  const offsetMs = cityClock.getTime() - now.getTime();
  const day = parseISODate(intentISO);
  const options = [{ value: NO_INTENT_TIME, label: 'Any time' }];
  for (let hour = 0; hour < 24; hour += 1) {
    // Built from the calendar parts rather than by adding milliseconds, so a
    // clock change inside the day cannot slide every chip by an hour.
    const wall = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
    if (wall.getTime() <= cityClock.getTime()) {
      continue;
    }
    if (wall.getTime() - offsetMs > expiresAt.getTime()) {
      break;
    }
    const value = `${String(hour).padStart(2, '0')}:00`;
    options.push({ value, label: intentTimeLabel(value) ?? value });
  }
  return options;
}

/** "Tonight" / "Tomorrow" / weekday label for a pin's intent date. */
export function intentLabel(intentISO: string, now = new Date()): string {
  const today = toISODate(now);
  if (intentISO === today) {
    return 'Today';
  }
  if (intentISO === toISODate(addDays(now, 1))) {
    return 'Tomorrow';
  }
  return dates().weekdayLongMonthDay.format(parseISODate(intentISO));
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
 * Which `intent_date` strings count as today (or tomorrow) on this phone.
 *
 * Two clocks write that column. The app writes the phone's LOCAL calendar day
 * (features/trips/dates toISODate, which is deliberately local because a trip
 * is a calendar range, not a timestamp). The curated seed writes Postgres's
 * `current_date`, which is UTC. An exact string compare therefore hides every
 * seeded plan from a traveler far enough east or west - and this is a travel
 * app, so "far enough" is the normal case. A founder at UTC-7 tapping Today at
 * six in the evening is asking about a day the server rolled past hours ago.
 *
 * Matching either date fixes that without ever showing a plan that has already
 * happened, which is what a looser `<=` comparison would have done.
 */
/**
 * Whether a plan is for a LATER day than today, on either of the two clocks
 * that write intent_date (see filterDates below). Markers burn a step dimmer
 * for later days; today, and a day already under way, burn at full amber.
 * ISO date strings compare correctly as strings.
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

export function filterDates(
  filter: 'today' | 'tomorrow' | 'later',
  now = new Date(),
  city: Date | null = null
): string[] {
  // 'later' is the day after tomorrow, which is as far as a pin can ever
  // reach: the lifetime is capped at 72 hours, so three days is the whole
  // universe rather than an arbitrary stopping point.
  const offset = filter === 'today' ? 0 : filter === 'tomorrow' ? 1 : 2;
  // The browsed CITY's calendar day leads when a city clock is given
  // (cityClockNow): the map is city-scoped, so "Today" is the city's today
  // and heatDay asks the server about that one. The device-local and UTC
  // candidates stay in the set — two clocks already write intent_date (see
  // above), and a third clock REPLACING that tolerance would hide seeded
  // pins from everyone. Widen, never swap.
  const cityDay = city != null ? toISODate(addDays(city, offset)) : null;
  const local = toISODate(addDays(now, offset));
  const utc = new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return [...new Set([...(cityDay != null ? [cityDay] : []), local, utc])];
}
