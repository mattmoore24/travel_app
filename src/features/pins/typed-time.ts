import { intentTimeLabel } from '@/features/pins/pin-helpers';
import { toISODate } from '@/features/trips/dates';
import { USES_24_HOUR_CLOCK } from '@/lib/locale';

/**
 * The time on a pin, TYPED.
 *
 * Founder, round 4: the start and the end of a plan are typed and optional,
 * the preset hour buttons go, and small text says the times are the
 * destination's own. This module is the reading half: it turns whatever a
 * person wrote into the 'HH:MM' the pin carries, or says why it could not.
 *
 * Generous on purpose, because a time is typed with one thumb on a phone in
 * a bar: "7pm", "7:30 PM", "7.30pm", "19:30", "1930", "19h30", "noon" and
 * "midnight" all read. Strict where a guess would be a lie: "7:60", "24",
 * "13pm" and "seven" are refused rather than rounded, and the form says how
 * to write one instead.
 *
 * THE BARE HOUR. "7" with no AM or PM is the one honest ambiguity. On a
 * 24-hour phone it is seven in the morning and reads that way. On a 12-hour
 * phone the box's own example says "7:30 PM", the keyboard has letters, and
 * "7" for drinks would have posted the morning, so it is not read: the form
 * asks for AM or PM. The END box is the exception either way: a bare hour
 * there is read against the start ("7pm to 11" is eleven at night, "10pm
 * to 2" is two in the morning), because that is the only thing it can mean.
 */
export type TypedTimeRead =
  | { value: string; problem?: undefined }
  | { value?: undefined; problem: 'unreadable' | 'meridiem' };

const MINUTES_IN_A_DAY = 24 * 60;

/** 'HH:MM' as minutes since midnight. */
export function minutesOfDay(hhmm: string): number {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Read a typed time. Null for a blank box, which is a real answer (no hour);
 * a problem for a box the form cannot honestly read; otherwise the value.
 * `after` is the start already read, for the end box.
 */
export function readTypedTime(text: string, after?: string | null): TypedTimeRead | null {
  let raw = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (raw === '') {
    return null;
  }
  if (raw === 'noon' || raw === 'midday') {
    return { value: '12:00' };
  }
  if (raw === 'midnight') {
    return { value: '00:00' };
  }
  // "p.m." and "a. m." lose their dots and spaces; the dot BETWEEN hour and
  // minute ("7.30") stays, since it is one of the separators read below.
  raw = raw.replace(/([ap])\.?\s?m\.?$/, '$1m');
  const match = /^(\d{1,2})(?:[:.h]?(\d{2}))?\s?(am|pm|a|p)?$/.exec(raw);
  if (!match) {
    return { problem: 'unreadable' };
  }
  let hour = Number(match[1]);
  const minute = match[2] == null ? 0 : Number(match[2]);
  const meridiem = match[3]?.[0];
  if (minute > 59) {
    return { problem: 'unreadable' };
  }
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return { problem: 'unreadable' };
    }
    if (meridiem === 'a' && hour === 12) {
      hour = 0;
    } else if (meridiem === 'p' && hour < 12) {
      hour += 12;
    }
    return { value: hhmm(hour, minute) };
  }
  if (hour > 23) {
    return { problem: 'unreadable' };
  }
  const bare = hour >= 1 && hour <= 12;
  if (bare && after != null) {
    // The end, read against the start: of the two hours "11" could be, the
    // first one after the start; when neither is (the window crosses
    // midnight), the earlier one, which is tomorrow morning.
    const morning = hour === 12 ? 0 : hour;
    const candidates = [morning, morning + 12].map((h) => hhmm(h, minute));
    const start = minutesOfDay(after);
    const next = candidates.find((candidate) => minutesOfDay(candidate) > start);
    return { value: next ?? candidates[0] };
  }
  if (bare && !USES_24_HOUR_CLOCK) {
    return { problem: 'meridiem' };
  }
  return { value: hhmm(hour, minute) };
}

/** The value alone, or null: the shape the tests table. */
export function parseTypedTime(text: string, after?: string | null): string | null {
  return readTypedTime(text, after)?.value ?? null;
}

/**
 * The example a field shows before anything is typed, in the phone's own
 * clock: "7:30 PM" on a 12-hour phone, "19:30" on a 24-hour one. Printed
 * through the one clock (lib/locale, via intentTimeLabel) rather than
 * hardcoded, so the example and the readout can never disagree.
 */
export function typedTimeExample(): string {
  return intentTimeLabel('19:30') ?? '19:30';
}

/** The example for the end of a window, later than the start's. */
export function typedTimeUntilExample(): string {
  return intentTimeLabel('22:00') ?? '22:00';
}

/** The longest window the form accepts, in minutes. Longer than this is a day. */
export const MAX_WINDOW_MINUTES = 12 * 60;

/**
 * How long a window is, in minutes, with an end at or before the start read
 * as past midnight (the server's own reading). Zero means the end IS the
 * start, which is no window at all.
 */
export function windowMinutes(start: string, end: string): number {
  return (minutesOfDay(end) - minutesOfDay(start) + MINUTES_IN_A_DAY) % MINUTES_IN_A_DAY;
}

/**
 * True when the typed time, on the plan's day, is already at or behind the
 * CITY's clock. The one refusal the hour rails had, kept: an hour already
 * gone where the plan is, is not a plan. Compared as wall-clock parts, never
 * as instants, so a clock change inside the day cannot let a time inside
 * the missing hour through or hold one inside the repeated hour.
 */
export function typedTimeHasPassed(time: string, dayISO: string, cityClock: Date): boolean {
  const today = toISODate(cityClock);
  if (dayISO !== today) {
    return dayISO < today;
  }
  return time <= hhmm(cityClock.getHours(), cityClock.getMinutes());
}
