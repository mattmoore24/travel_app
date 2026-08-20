import type { MessageRow } from '@/lib/database.types';

/** Longer than this between messages and the thread gets a time stamp. */
const TIMESTAMP_GAP_MS = 60 * 60 * 1000;

const TIME = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });

function dayLabel(iso: string) {
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
