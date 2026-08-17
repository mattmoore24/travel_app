import { addDays, toISODate } from '@/features/trips/dates';

import {
  MAX_PIN_HOURS,
  expiryForDuration,
  expiryForIntentDate,
  intentDateOptions,
  intentLabel,
  validDurations,
} from '../pin-helpers';

describe('pin lifetime helpers (hard rule 3: <=72h)', () => {
  it('offers exactly today/tomorrow/day-after as intent dates', () => {
    const now = new Date(2026, 2, 4, 15, 0); // Mar 4, 3pm local
    const options = intentDateOptions(now);
    expect(options.map((o) => o.value)).toEqual(['2026-03-04', '2026-03-05', '2026-03-06']);
    expect(options[0].label).toBe('Today');
    expect(options[1].label).toBe('Tomorrow');
  });

  it('expires at the end of the intent day when within the cap', () => {
    const now = new Date(2026, 2, 4, 15, 0);
    const expiry = expiryForIntentDate('2026-03-04', now);
    expect(toISODate(expiry)).toBe('2026-03-05'); // local midnight after intent day
    expect(expiry.getHours()).toBe(0);
  });

  it('never exceeds 72 hours even for the furthest intent day', () => {
    const now = new Date(2026, 2, 4, 23, 30); // late evening
    const furthest = intentDateOptions(now)[2].value;
    const expiry = expiryForIntentDate(furthest, now);
    const hours = (expiry.getTime() - now.getTime()) / 3_600_000;
    expect(hours).toBeLessThanOrEqual(MAX_PIN_HOURS);
    expect(hours).toBeGreaterThan(0);
  });

  it('honors user-set durations, always safely inside the 72h server cap', () => {
    const now = new Date(2026, 2, 4, 15, 0);
    expect(expiryForDuration('24h', '2026-03-04', now).getTime() - now.getTime()).toBe(
      24 * 3_600_000
    );
    // Exactly 72h would race the DB CHECK on any clock-ahead device; the
    // helper keeps a safety margin strictly inside the cap.
    const seventyTwo =
      (expiryForDuration('72h', '2026-03-06', now).getTime() - now.getTime()) / 3_600_000;
    expect(seventyTwo).toBeLessThan(MAX_PIN_HOURS);
    expect(seventyTwo).toBeGreaterThan(MAX_PIN_HOURS - 0.25);
    expect(expiryForDuration('end_of_day', '2026-03-04', now)).toEqual(
      expiryForIntentDate('2026-03-04', now)
    );
  });

  it('filters durations that would kill the pin before its intent day', () => {
    const now = new Date(2026, 2, 4, 15, 0); // Mar 4, 3pm
    // Intent = day after tomorrow: a 24h lifetime dies Mar 5, before Mar 6.
    expect(validDurations('2026-03-06', now)).not.toContain('24h');
    expect(validDurations('2026-03-06', now)).toContain('end_of_day');
    expect(validDurations('2026-03-06', now)).toContain('72h');
    // Intent = today: everything works.
    expect(validDurations('2026-03-04', now)).toEqual(['end_of_day', '24h', '48h', '72h']);
  });

  it('labels intent dates for humans', () => {
    const now = new Date(2026, 2, 4, 12, 0);
    expect(intentLabel(toISODate(now), now)).toBe('Today');
    expect(intentLabel(toISODate(addDays(now, 1)), now)).toBe('Tomorrow');
    expect(intentLabel('2026-03-06', now)).toContain('Friday');
  });
});
