// Date-only helpers for trips. Trips are calendar ranges ("Mar 4–9"), so
// everything works on YYYY-MM-DD strings and local dates — never UTC
// timestamps, which shift a day depending on the traveler's timezone.
//
// No formatter of its own. Every string this file prints comes from
// lib/locale's `dates()`, which is the app's one date engine: this file used
// to pin four formatters to 'en' beside four other files that followed the
// device, and src/lib/__tests__/one-clock.test.ts now refuses a second engine
// anywhere under src/.

import { dates } from '@/lib/locale';

export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** Whole days from today to an ISO date (negative when it's in the past). */
export function daysUntil(iso: string): number {
  const today = parseISODate(toISODate(new Date()));
  return Math.round((parseISODate(iso).getTime() - today.getTime()) / 86_400_000);
}

/** "2026-03-04" -> "Mar 4" (with the year once it is not this one). */
export function formatDate(iso: string): string {
  const date = parseISODate(iso);
  const fmt =
    date.getFullYear() === new Date().getFullYear() ? dates().monthDay : dates().monthDayYear;
  return fmt.format(date);
}

/** "2026-03-04".."2026-03-09" -> "Mar 4 – 9" / "Mar 30 – Apr 2" (year only when not current). */
export function formatDateRange(startISO: string, endISO: string): string {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const sameYear = start.getFullYear() === end.getFullYear();
  const currentYear = start.getFullYear() === new Date().getFullYear();
  const { monthDay, monthDayYear } = dates();
  const fmt = sameYear && currentYear ? monthDay : monthDayYear;
  if (startISO === endISO) {
    return fmt.format(start);
  }
  if (sameYear && start.getMonth() === end.getMonth()) {
    return `${monthDay.format(start)} – ${end.getDate()}${currentYear ? '' : `, ${end.getFullYear()}`}`;
  }
  return `${fmt.format(start)} – ${fmt.format(end)}`;
}

/** Client mirror of the DB trip rules; returns an error message or null. */
export function validateTripRange(startISO: string, endISO: string): string | null {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const today = parseISODate(toISODate(new Date()));
  if (end < start) {
    return 'The trip must end after it starts.';
  }
  if (end < today) {
    return 'This trip is entirely in the past.';
  }
  if ((end.getTime() - start.getTime()) / 86_400_000 > 365) {
    return 'Trips are capped at a year.';
  }
  if ((start.getTime() - today.getTime()) / 86_400_000 > 730) {
    return 'That start date is too far out.';
  }
  return null;
}

/**
 * The dates on a trip, said the way a reader is allowed to believe them.
 *
 * A rough window is the widest range its owner will stand behind, so printing
 * it bare states two days nobody picked. One sentence beats a range with a
 * disclaimer beside it: somebody deciding whether to book flights around
 * these dates should not have to notice a second element to learn the first
 * one is a guess.
 */
export function formatTripDates(startISO: string, endISO: string, approximate?: boolean): string {
  const range = formatDateRange(startISO, endISO);
  return approximate ? `Around ${range}` : range;
}

/**
 * A month on its own: "Sep", "September", and the year on the end once it is
 * not this one ("Jan 2027").
 *
 * Takes any date in the month, so both an ISO date and a "YYYY-MM" work.
 * rough-dates.tsx asks here for its chip labels rather than building its
 * own, and this asks lib/locale, whose bare-month shapes exist for this one
 * caller.
 */
export function formatMonth(iso: string, style: 'short' | 'long' = 'short'): string {
  const date = parseISODate(iso.length === 7 ? `${iso}-01` : iso);
  const month = (style === 'short' ? dates().month : dates().monthLong).format(date);
  return date.getFullYear() === new Date().getFullYear() ? month : `${month} ${date.getFullYear()}`;
}

/**
 * When a rough window is, at the scale its owner actually chose: "in
 * September", or "between September and October" once it crosses a month.
 *
 * For the one place that has room for a phrase and no licence to name a day.
 * `formatTripDates` is the right thing almost everywhere - "Around Sep 1 –
 * 30" is honest and precise about how wide the guess is - but a line that
 * reads "In Lisbon from <date>" cannot be repaired by prefixing a word,
 * because the sentence is built around a single arrival day. Drop to the
 * scale the traveler picked instead.
 */
export function roughWhen(startISO: string, endISO: string): string {
  const from = formatMonth(startISO, 'long');
  const to = formatMonth(endISO, 'long');
  return from === to ? `in ${from}` : `between ${from} and ${to}`;
}

/**
 * The widest range a rough window is allowed to mean, from the two things a
 * traveler without dates actually knows: a month, and roughly how long.
 *
 * THE RULE, written down once so the picker, the profile and the overlap
 * query cannot each invent their own. The window opens on the FIRST of the
 * month and closes on the LAST of it, or `lengthDays` after it opened,
 * whichever is later.
 *
 *   "About a week in September"      -> Sep 1 – 30
 *   "About two weeks in September"   -> Sep 1 – 30
 *   "About two months from September"-> Sep 1 – Oct 30
 *
 * So the month is the claim and the length only pushes the far edge out when
 * the stay cannot fit inside it. That asymmetry is deliberate: widening a
 * window widens who it overlaps, and an approximate September trip that
 * overlapped everybody in September AND October would inflate every match
 * count in the city, which is the failure the brief calls a collapsing accept
 * rate. "Two months from September" is a claim about September plus a length,
 * not about October as a second guess.
 *
 * Capped at the 365 days the table's own check allows
 * (20260816200000_trips_matching.sql:185), so the widest thing this can
 * produce is still a trip Postgres will take.
 */
const ROUGH_MAX_SPAN_DAYS = 365;

export function rangeForRoughDates(
  /** The month the traveler picked, as "YYYY-MM". */
  monthISO: string,
  lengthDays: number
): { start: string; end: string } {
  const [year, month] = monthISO.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  // Day 0 of the next month is the last day of this one, leap years included.
  const lastOfMonth = new Date(year, month, 0);
  const stay = Math.max(1, Math.round(lengthDays));
  const byLength = addDays(first, stay - 1);
  const end = byLength > lastOfMonth ? byLength : lastOfMonth;
  const cap = addDays(first, ROUGH_MAX_SPAN_DAYS);
  return { start: toISODate(first), end: toISODate(end > cap ? cap : end) };
}
