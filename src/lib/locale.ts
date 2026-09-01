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
 * the one call site (docs/ARCHITECTURE.md, D5).
 *
 * Both halves of the answer now live below: `clocks()` for anything that
 * prints an hour, `dates()` for anything that prints a day. Moving the last
 * formatters in `src/features` onto them is the tail of the same package, and
 * `src/lib/__tests__/one-clock.test.ts` names every site still outstanding so
 * the list can only shrink.
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
 * The tag EXACTLY as the phone reported it, or null when it reported none.
 * The one export in this file that does NOT fall back, and the difference is
 * the whole point of it existing beside `DEVICE_LOCALE` below.
 *
 * A formatter always needs some locale, so 'en-US' is the right answer when
 * the phone will not say - nobody is harmed by a machine guessing at month
 * order. A PERSON's language is the other kind of question: `profiles.locale`
 * decides which language a moderation verdict about somebody's face or
 * somebody's livelihood is written in, and there null means English silently
 * while a guess means a rejection in a language they may not read, from an
 * app that was sure it knew better. So the guess is made where it is
 * harmless, and never in the value the write takes.
 *
 * `src/lib/device-locale.ts` is that write, and it is the only other reader
 * of this constant. It asks HERE rather than calling `getLocales()` a second
 * time: this file is the one place the phone is asked (docs/ARCHITECTURE.md,
 * D5), and `src/lib/__tests__/one-clock.test.ts` fails the build if a third
 * caller appears.
 */
export const DEVICE_LOCALE_TAG: string | null = locale.languageTag ?? null;

/**
 * The full BCP 47 tag, region included: 'en-US', 'pt-PT', 'es-419'. This is
 * what `Intl` wants. Never pass a bare 'en' where this belongs, or American
 * month/day order comes back on a British phone.
 */
export const DEVICE_LOCALE: string = DEVICE_LOCALE_TAG || 'en-US';

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
 * THE locale every formatter in the app is built with, and there is exactly
 * one of it.
 *
 * It is 'en' and not `DEVICE_LOCALE`, which is the same call the clock above
 * already made and for the same reason: decision D5 keeps the app's WORDS
 * English for v1, and a formatter handed the phone's tag writes its words in
 * the phone's language. That is how a Portuguese phone got "agosto 2026" as a
 * calendar header with "Aug 30 to Sep 2" in the summary directly beneath it -
 * one screen in two languages, which reads as a half-finished translation
 * rather than as a product decision.
 *
 * Being uniformly English is a decision somebody made. Being English in
 * thirteen places and Portuguese in four is a bug, and it is the bug this
 * constant exists to make unrepresentable.
 *
 * The CONVENTIONS that carry no words still follow the phone - the clock's
 * `hour12` below is the whole example - because twelve-versus-twenty-four
 * changes what the digits MEAN. A month name is just a word, and this app's
 * words are English.
 *
 * If the founder later decides the dates should localise, this is the one
 * line that changes, and `src/lib/__tests__/one-clock.test.ts` is what keeps
 * it the one line. Note what that costs before flipping it: every date string
 * changes width overnight (German month names, Japanese ordering), so every
 * fixed-width date container has to be re-photographed, not just typechecked.
 */
export const LOCALE = 'en';

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
      instant: new Intl.DateTimeFormat(LOCALE, shape),
      /**
       * A wall-clock time, which carries no date and no zone: it is 18:00 at
       * that door. Anchored to a fixed UTC instant and read back in UTC, so
       * no runner's timezone and no daylight-saving jump can move it.
       */
      wall: new Intl.DateTimeFormat(LOCALE, { ...shape, timeZone: 'UTC' }),
    };
  }
  return clockFormats;
}

/**
 * THE app's dates, and there is exactly one set of them.
 *
 * The clock above closed the two-engine bug for TIMES and left the same bug
 * standing for DAYS: thirteen call sites named 'en' by hand and four passed
 * `undefined`, which is the device. So the shapes below are named by what
 * they SAY rather than by their options, and every screen that prints a day
 * asks here - the same rule, and the same one place to change, as the clock.
 *
 * Six shapes, not one per call site. A seventh means a screen is saying
 * something none of the others say, which is worth a moment's thought before
 * it is worth a formatter.
 *
 * A numeric date is deliberately NOT among them. "3/4" is March 4 to an
 * American and 3 April to nearly everyone else this app is for, and the app's
 * readers are by definition abroad.
 *
 * Memoised behind an accessor rather than built at import time, for the same
 * reason as the clock: a test can stub the preference and load the module
 * again.
 */
type DateFormats = {
  /** "Mar 4" - the everyday date, and the one most rows want. */
  monthDay: Intl.DateTimeFormat;
  /** "Mar 4, 2027" - the same date once the year is not this one. */
  monthDayYear: Intl.DateTimeFormat;
  /** "Sat" - inside the last week, a weekday says more than a date. */
  weekday: Intl.DateTimeFormat;
  /** "Sat, Mar 4" - a day separator, and the day a plan is for. */
  weekdayMonthDay: Intl.DateTimeFormat;
  /** "Saturday" - a day picker's third chip, where there is room to say it. */
  weekdayLong: Intl.DateTimeFormat;
  /** "Saturday, Mar 4" - a plan's day, spelled out. */
  weekdayLongMonthDay: Intl.DateTimeFormat;
  /** "March 2027" - a calendar's month header. */
  monthYear: Intl.DateTimeFormat;
  /**
   * "Saturday, 4 March" - a date SPOKEN. VoiceOver reads a calendar cell,
   * and "Mar 4" is read as an abbreviation there; this is the one shape that
   * exists for the ear rather than for the eye.
   */
  spokenDate: Intl.DateTimeFormat;
};

let dateFormats: DateFormats | null = null;

export function dates(): DateFormats {
  if (dateFormats == null) {
    dateFormats = {
      monthDay: new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' }),
      monthDayYear: new Intl.DateTimeFormat(LOCALE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      weekday: new Intl.DateTimeFormat(LOCALE, { weekday: 'short' }),
      weekdayMonthDay: new Intl.DateTimeFormat(LOCALE, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }),
      weekdayLong: new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }),
      weekdayLongMonthDay: new Intl.DateTimeFormat(LOCALE, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
      }),
      monthYear: new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }),
      spokenDate: new Intl.DateTimeFormat(LOCALE, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    };
  }
  return dateFormats;
}
