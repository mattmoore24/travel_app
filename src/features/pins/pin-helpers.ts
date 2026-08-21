import { addDays, parseISODate, toISODate } from '@/features/trips/dates';
import type { PinCategory } from '@/lib/database.types';

export const PIN_CATEGORIES: { value: PinCategory; label: string; emoji: string }[] = [
  { value: 'bar', label: 'Bar', emoji: '🍸' },
  { value: 'restaurant', label: 'Food', emoji: '🍜' },
  { value: 'club', label: 'Club', emoji: '🪩' },
  { value: 'museum', label: 'Museum', emoji: '🖼️' },
  { value: 'monument', label: 'Sights', emoji: '🏛️' },
  { value: 'beach', label: 'Beach', emoji: '🏖️' },
  { value: 'hike', label: 'Hike', emoji: '🥾' },
  { value: 'other', label: 'Other', emoji: '📍' },
];

export const SEEDED_EMOJI = '⭐';

export function categoryEmoji(category: PinCategory, seeded: boolean): string {
  if (seeded) {
    return SEEDED_EMOJI;
  }
  return PIN_CATEGORIES.find((c) => c.value === category)?.emoji ?? '📍';
}

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

/** Where the slider sits before anyone touches it: the end of the plan's day. */
export function defaultHoursForIntent(intentISO: string, now = new Date()): number {
  const endOfDay = expiryForIntentDate(intentISO, now);
  const hours = Math.round((endOfDay.getTime() - now.getTime()) / 3_600_000);
  return Math.min(Math.max(hours, minHoursForIntent(intentISO, now)), MAX_PIN_HOURS);
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
