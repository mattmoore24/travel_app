// Date-only helpers for trips. Trips are calendar ranges ("Mar 4–9"), so
// everything works on YYYY-MM-DD strings and local dates — never UTC
// timestamps, which shift a day depending on the traveler's timezone.

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

const SHORT = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const SHORT_YEAR = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/** "2026-03-04".."2026-03-09" -> "Mar 4 – 9" / "Mar 30 – Apr 2" (year only when not current). */
export function formatDateRange(startISO: string, endISO: string): string {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const sameYear = start.getFullYear() === end.getFullYear();
  const currentYear = start.getFullYear() === new Date().getFullYear();
  const fmt = sameYear && currentYear ? SHORT : SHORT_YEAR;
  if (startISO === endISO) {
    return fmt.format(start);
  }
  if (sameYear && start.getMonth() === end.getMonth()) {
    return `${SHORT.format(start)} – ${end.getDate()}${currentYear ? '' : `, ${end.getFullYear()}`}`;
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
