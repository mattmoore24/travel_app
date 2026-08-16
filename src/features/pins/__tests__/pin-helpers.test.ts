import { addDays, toISODate } from '@/features/trips/dates';

import {
  MAX_PIN_HOURS,
  expiryForDuration,
  expiryForIntentDate,
  intentDateOptions,
  intentLabel,
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

  it('honors user-set durations, always capped at 72h', () => {
    const now = new Date(2026, 2, 4, 15, 0);
    expect(expiryForDuration('24h', '2026-03-04', now).getTime() - now.getTime()).toBe(
      24 * 3_600_000
    );
    expect(expiryForDuration('72h', '2026-03-06', now).getTime() - now.getTime()).toBe(
      MAX_PIN_HOURS * 3_600_000
    );
    expect(expiryForDuration('end_of_day', '2026-03-04', now)).toEqual(
      expiryForIntentDate('2026-03-04', now)
    );
  });

  it('labels intent dates for humans', () => {
    const now = new Date(2026, 2, 4, 12, 0);
    expect(intentLabel(toISODate(now), now)).toBe('Today');
    expect(intentLabel(toISODate(addDays(now, 1)), now)).toBe('Tomorrow');
    expect(intentLabel('2026-03-06', now)).toContain('Friday');
  });
});
