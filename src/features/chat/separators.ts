import type { MessageRow } from '@/lib/database.types';
import { clocks, dates } from '@/lib/locale';

/** Longer than this between messages and the thread gets a time stamp. */
const TIMESTAMP_GAP_MS = 60 * 60 * 1000;

// No local formatter, for either half of a stamp. The clock was the first
// half: with no `hour12` it is 12-hour on every phone in the world, so a
// traveler read "9:14 PM" on a message and "Open · till 02:00" on the bar it
// was about. The DAY was the second, and it failed the other way round - a
// formatter here said 'en' while the "you leave" line one row down passed
// `undefined`, so a Portuguese phone drew both languages on one screen.
// lib/locale is the app's one answer to both questions.
// Accessed per call rather than destructured at import, because the accessors
// memoise and a test can stub the preference and reload.

export function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) {
    return 'Today';
  }
  if (sameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return dates().weekdayMonthDay.format(date);
}

/**
 * What sits between two messages: nothing at all when they are minutes
 * apart, the time when they are more than an hour apart, the day and the
 * time when the day changed. This is how every messaging app does it, and it
 * is the reason a timestamp does not belong inside the bubble.
 */
export function separatorFor(current: MessageRow, older: MessageRow | undefined): string | null {
  const at = new Date(current.created_at);
  if (older == null) {
    return `${dayLabel(current.created_at)} ${clocks().instant.format(at)}`;
  }
  const previous = new Date(older.created_at);
  if (previous.toDateString() !== at.toDateString()) {
    return `${dayLabel(current.created_at)} ${clocks().instant.format(at)}`;
  }
  if (at.getTime() - previous.getTime() >= TIMESTAMP_GAP_MS) {
    return clocks().instant.format(at);
  }
  return null;
}

/**
 * What a chat LIST row shows on the right: the time if it happened today,
 * 'Yesterday', the weekday inside the last week, and a date beyond that. The
 * same vocabulary as the in-thread separators above, compressed to the width
 * a row can spare.
 */
export function rowTimestamp(iso: string | null, now: Date = new Date()): string {
  if (!iso) {
    return '';
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return '';
  }
  const label = dayLabel(iso);
  if (label === 'Today') {
    return clocks().instant.format(at);
  }
  if (label === 'Yesterday') {
    return 'Yesterday';
  }
  // Inside the last week the weekday is more useful than the date, which is
  // how every messaging app people already use reads.
  const days = (now.getTime() - at.getTime()) / 86400000;
  if (days >= 0 && days < 7) {
    return dates().weekday.format(at);
  }
  // 'Mar 4', never '3/4': a numeric date means March 4 to an American and
  // 3 April to nearly everyone else this app is for. Unambiguous in every
  // Latin-script locale, and one or two characters wider in a column already
  // sized for 'Yesterday'. lib/locale's `dates()` has no numeric shape at
  // all, which is how that stays true of every screen rather than of this one.
  return dates().monthDay.format(at);
}

/** 12 becomes '12'; anything past 99 becomes '99+' rather than a wide pill. */
export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}
