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

/**
 * THE app's clock, and there is exactly one.
 *
 * The app kept two and they disagreed on the same evening: chat separators
 * used `Intl.DateTimeFormat('en', …)` with no `hour12`, which is 12-hour,
 * while business hours came through as a slice of '18:00:00', which is 24.
 * So a traveler read "9:14 PM" on a message and "Open · till 02:00" on the
 * bar it was about.
 *
 * The fix people reach for first is to pin chat to 24-hour, and it is wrong
 * in a way that is easy to miss: it makes the two agree only on phones
 * already set to 24-hour, and leaves an American reading "9:14 PM" against
 * "till 02:00" exactly as before. The disagreement was never about which
 * format is right. It was about there being two answers to one question.
 *
 * So there is one answer, the PHONE's, and everything that prints a time asks
 * HERE. It lives in lib rather than in either feature because both chat and
 * business need it and neither should depend on the other — the first version
 * of this put it inside features/business/vocabulary, and chat was never
 * wired to it, so the app went right on keeping two clocks.
 *
 * The LOCALE stays 'en' while the CONVENTION follows the phone. D5 keeps the
 * app's strings English for v1, and a Portuguese phone set to 12 hours would
 * otherwise print "9:14 da tarde" into an English row. Twelve-versus-
 * twenty-four changes what the digits MEAN; the day-period word is just a
 * word, and this app's words are English.
 *
 * Memoised behind an accessor rather than built at import time, so a test can
 * stub the preference and load the module again.
 */
let clockFormats: { instant: Intl.DateTimeFormat; wall: Intl.DateTimeFormat } | null = null;

export function clocks(): { instant: Intl.DateTimeFormat; wall: Intl.DateTimeFormat } {
  if (clockFormats == null) {
    const shape: Intl.DateTimeFormatOptions = {
      hour: 'numeric',
      minute: '2-digit',
      hour12: !USES_24_HOUR_CLOCK,
    };
    clockFormats = {
      /** A moment in time: a message, an event. Rendered in the device zone. */
      instant: new Intl.DateTimeFormat('en', shape),
      /**
       * A wall-clock time, which carries no date and no zone: it is 18:00 at
       * that door. Anchored to a fixed UTC instant and read back in UTC, so
       * no runner's timezone and no daylight-saving jump can move it.
       */
      wall: new Intl.DateTimeFormat('en', { ...shape, timeZone: 'UTC' }),
    };
  }
  return clockFormats;
}
