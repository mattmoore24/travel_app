import { getCalendars, getLocales, type Calendar, type Locale } from 'expo-localization';

/**
 * What the phone says about its own conventions, asked once.
 *
 * Decision D5: the app's STRINGS stay English for v1, but the traveler's own
 * data (dates, times, the week's first day) is to render in their
 * conventions. The app guesses today: eleven formatters are pinned to
 * `Intl.DateTimeFormat('en')` while six follow the device, so a Portuguese
 * phone shows "agosto 2026" as a calendar header and "Aug 30 to Sep 2" in the
 * summary directly beneath it, and chat times are locked to 12-hour AM/PM
 * worldwide while business hours in the same app are 24-hour. expo-
 * localization was a declared dependency with zero call sites; this file is
 * the one call site, and migrating the eleven formatters onto it is its own
 * package (docs/ARCHITECTURE.md, D5).
 *
 * READ AT MODULE LOAD, so the values are frozen for the life of the process.
 * Somebody who changes their phone's language or region mid-session keeps the
 * old formatting until the app is relaunched. That is standard behaviour and
 * it is not worth a subscription: iOS restarts the app on a language change
 * anyway, and a region change mid-trip is not a case worth the complexity.
 *
 * Every value has a fallback, because every one of them can be null on some
 * platform: `uses24hourClock` and `firstWeekday` on browsers with no
 * `hourCycle` or `weekInfo`, `timeZone` on web. The fallbacks are the ones
 * this app already behaved as if it had.
 */

/**
 * The INDEX needs a fallback too, and that is not paranoia about a typed
 * value.
 *
 * `getLocales()` and `getCalendars()` are declared as `[Locale, ...Locale[]]`
 * — a non-empty tuple — so `[0]` types as present whatever
 * `noUncheckedIndexedAccess` is set to, and every `??` below reads as total
 * coverage. It is not: the guarantee is a comment in expo-localization's
 * types, and what actually answers is a native module (or, under test, a
 * mock). Hand back `[]` and the first PROPERTY read throws a TypeError at
 * module load, before any fallback in this file has a chance to run and
 * before a single screen mounts. Widening the array type is what makes the
 * `?? {}` legal rather than dead code the compiler strips from its checking.
 */
const locales: Partial<Locale>[] = getLocales();
const calendars: Partial<Calendar>[] = getCalendars();

const locale: Partial<Locale> = locales[0] ?? {};
const calendar: Partial<Calendar> = calendars[0] ?? {};

/**
 * The full BCP 47 tag, region included: 'en-US', 'pt-PT', 'es-419'. This is
 * what `Intl` wants. Never pass a bare 'en' where this belongs, or American
 * month/day order comes back on a British phone.
 */
export const DEVICE_LOCALE: string = locale.languageTag || 'en-US';

/** Just the language: 'en', 'pt', 'th'. Useful for a lookup, not for Intl. */
export const DEVICE_LANGUAGE: string = locale.languageCode || 'en';

/**
 * True where the phone is set to a 24-hour clock. Passed to Intl as
 * `hour12: !USES_24_HOUR_CLOCK`, which is the only honest way to render a
 * time: this app had one screen saying 21:00 and another saying 9:00 PM.
 */
export const USES_24_HOUR_CLOCK: boolean = calendar.uses24hourClock ?? false;

/**
 * The first day of the week, 1 = Sunday through 7 = Saturday, which is
 * expo-localization's `Weekday` numbering and NOT JavaScript's
 * `Date.getDay()` (0 = Sunday). Convert with `FIRST_WEEKDAY - 1` before
 * comparing to a Date.
 */
export const FIRST_WEEKDAY: number = calendar.firstWeekday ?? 1;

/** The device's IANA zone, e.g. 'Europe/Lisbon'. */
export const DEVICE_TIME_ZONE: string = calendar.timeZone || 'UTC';
