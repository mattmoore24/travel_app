/**
 * A time somebody TYPED, read into 'HH:MM'.
 *
 * Founder, 2026-09-05: "Time is still not something the user can type when
 * making a pin. It should not be a button. It should be something the user can
 * optionally type in for the beginning and end time."
 *
 * The rails of preset hours this replaces could only ever offer the hours that
 * fitted inside a pin's remaining lifetime, so the control shrank as the
 * lifetime did and vanished entirely when nothing fitted. Typing has no such
 * problem, but it has a different one: '7' means two different times on two
 * different phones, and getting it wrong by twelve hours is worse than asking.
 *
 * So this is deliberately strict in exactly one place. On a 12-hour phone a
 * bare hour is REFUSED rather than guessed, because 'meet at 7' is the evening
 * to every person who types it and 07:00 to every naive parser. Everywhere
 * else it is generous: 7:30 pm, 7:30PM, 7pm, 7 pm, 19:30, 1930 and 19 all
 * read, and on a 24-hour phone a bare 7 reads as 07:00 because that is what
 * somebody on a 24-hour clock means by it.
 *
 * No React and no Date: a pure function over a string, so the whole grid of
 * inputs is a table test rather than a render.
 */

/** What the parser can say about a string. `null` means "nothing typed yet". */
export type TypedTime = { value: string } | { error: 'ambiguous' | 'unreadable' } | null;

/**
 * `afterHHMM` resolves the one ambiguous case. The END field knows the START,
 * and a plan that starts at 19:00 and ends at '11' cannot mean 11:00 that
 * morning, so the end field passes the start and a bare hour becomes readable.
 * The start field passes nothing and refuses.
 */
export function parseTypedTime(
  text: string,
  { hour12, afterHHMM }: { hour12: boolean; afterHHMM?: string | null }
): TypedTime {
  const raw = text.trim().toLowerCase();
  if (raw.length === 0) {
    return null;
  }

  // The meridiem, taken off the end before any digits are read: 'pm', 'p.m.',
  // 'p' and a space before any of them.
  const meridiem = /(a|p)\.?m?\.?$/.exec(raw.replace(/\s+/g, ''));
  const stripped = raw.replace(/\s+/g, '').replace(/(a|p)\.?m?\.?$/, '');
  const pm = meridiem?.[1] === 'p';
  const named = meridiem != null;

  let hour: number;
  let minute: number;

  const colon = /^(\d{1,2}):(\d{2})$/.exec(stripped);
  const packed = /^(\d{3,4})$/.exec(stripped);
  const bare = /^(\d{1,2})$/.exec(stripped);

  if (colon) {
    hour = Number(colon[1]);
    minute = Number(colon[2]);
  } else if (packed) {
    // 1930 and 930. Read from the right so a three-digit string keeps its
    // minutes: '930' is 9:30, never 93:0.
    const digits = packed[1];
    hour = Number(digits.slice(0, digits.length - 2));
    minute = Number(digits.slice(-2));
  } else if (bare) {
    hour = Number(bare[1]);
    minute = 0;
  } else {
    return { error: 'unreadable' };
  }

  if (minute > 59) {
    return { error: 'unreadable' };
  }

  if (named) {
    // With am or pm the hour must be one of the twelve, and 12 is the odd one:
    // 12 am is midnight and 12 pm is noon.
    if (hour < 1 || hour > 12) {
      return { error: 'unreadable' };
    }
    if (pm && hour !== 12) {
      hour += 12;
    }
    if (!pm && hour === 12) {
      hour = 0;
    }
    return { value: format(hour, minute) };
  }

  if (hour > 23) {
    return { error: 'unreadable' };
  }

  // THE ONE REFUSAL. A bare 1 to 12 on a 12-hour phone, with nothing to
  // resolve it against, is a coin flip between morning and evening. Everything
  // else is unambiguous: 0 and 13 to 23 can only be one time, a typed colon
  // means the person is thinking in 24 hours, and a 24-hour phone means they
  // always are.
  const ambiguous = hour12 && hour >= 1 && hour <= 12 && bare != null;
  if (ambiguous) {
    if (!afterHHMM) {
      return { error: 'ambiguous' };
    }
    // THE EARLIEST READING THAT STILL COMES AFTER THE START, which is not the
    // same as "a reading that comes after the start": 09:00 to '11' has two
    // readings after it, 11:00 and 23:00, and the person means the nearer one.
    // Picking merely a later reading made every morning plan run till eleven
    // at night.
    const startMinutes = Number(afterHHMM.slice(0, 2)) * 60 + Number(afterHHMM.slice(3, 5));
    // Bare 12 is the odd pair: its two readings are midnight and noon.
    const readings = (hour === 12 ? [0, 12] : [hour, hour + 12]).map((h) => h * 60 + minute);
    const after = readings.filter((m) => m > startMinutes).sort((a, b) => a - b);
    // None after the start means the plan crosses midnight, which the server
    // already reads as tomorrow, so the EARLIEST reading is the honest one:
    // 19:00 to '2' is two in the morning, not two in the afternoon.
    const chosen = after.length > 0 ? after[0] : Math.min(...readings);
    return { value: format(Math.floor(chosen / 60), chosen % 60) };
  }

  return { value: format(hour, minute) };
}

function format(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
