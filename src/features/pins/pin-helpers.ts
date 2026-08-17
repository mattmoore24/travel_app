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
