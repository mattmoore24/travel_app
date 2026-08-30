import { metersBetween } from '@/features/pins/cluster';
import { addDays, parseISODate, toISODate } from '@/features/trips/dates';
import type { PinCategory } from '@/lib/database.types';

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

/** The plan text, or null when there is none worth showing. */
export function pinSubtitle(pin: { note: string | null }): string | null {
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
      offset === 0
        ? 'Today'
        : offset === 1
          ? 'Tomorrow'
          : new Intl.DateTimeFormat('en', { weekday: 'long' }).format(date);
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

/** "Tonight" / "Tomorrow" / weekday label for a pin's intent date. */
export function intentLabel(intentISO: string, now = new Date()): string {
  const today = toISODate(now);
  if (intentISO === today) {
    return 'Today';
  }
  if (intentISO === toISODate(addDays(now, 1))) {
    return 'Tomorrow';
  }
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' }).format(
    parseISODate(intentISO)
  );
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
export function filterDates(filter: 'today' | 'tomorrow' | 'later', now = new Date()): string[] {
  // 'later' is the day after tomorrow, which is as far as a pin can ever
  // reach: the lifetime is capped at 72 hours, so three days is the whole
  // universe rather than an arbitrary stopping point.
  const offset = filter === 'today' ? 0 : filter === 'tomorrow' ? 1 : 2;
  const local = toISODate(addDays(now, offset));
  const utc = new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return local === utc ? [local] : [local, utc];
}
