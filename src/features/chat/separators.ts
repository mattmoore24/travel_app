import type { MessageRow } from '@/lib/database.types';

/** Longer than this between messages and the thread gets a time stamp. */
const TIMESTAMP_GAP_MS = 60 * 60 * 1000;

const TIME = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });

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
  return DAY.format(date);
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
    return `${dayLabel(current.created_at)} ${TIME.format(at)}`;
  }
  const previous = new Date(older.created_at);
  if (previous.toDateString() !== at.toDateString()) {
    return `${dayLabel(current.created_at)} ${TIME.format(at)}`;
  }
  if (at.getTime() - previous.getTime() >= TIMESTAMP_GAP_MS) {
    return TIME.format(at);
  }
  return null;
}

/**
 * What a chat LIST row shows on the right: the time if it happened today,
 * 'Yesterday', the weekday inside the last week, and a date beyond that. The
 * same vocabulary as the in-thread separators above, compressed to the width
 * a row can spare.
 */
const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'short' });
const SHORT_DATE = new Intl.DateTimeFormat('en', { month: 'numeric', day: 'numeric' });

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
    return TIME.format(at);
  }
  if (label === 'Yesterday') {
    return 'Yesterday';
  }
  // Inside the last week the weekday is more useful than the date, which is
  // how every messaging app people already use reads.
  const days = (now.getTime() - at.getTime()) / 86400000;
  if (days >= 0 && days < 7) {
    return WEEKDAY.format(at);
  }
  return SHORT_DATE.format(at);
}

/** 12 becomes '12'; anything past 99 becomes '99+' rather than a wide pill. */
export function unreadLabel(count: number): string {
  return count > 99 ? '99+' : String(count);
}
