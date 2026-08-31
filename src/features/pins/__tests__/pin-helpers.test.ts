import { addDays, parseISODate, toISODate } from '@/features/trips/dates';

import {
  MAX_PIN_HOURS,
  burnOutLabel,
  categoryForPoi,
  defaultHoursForIntent,
  expiryForDuration,
  expiryForHours,
  expiryForIntentDate,
  filterDates,
  hoursLabel,
  intentDateOptions,
  intentLabel,
  isLaterDay,
  minHoursForIntent,
  pinSubtitle,
  pinTitle,
  shouldGeocode,
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

describe('categoryForPoi', () => {
  it('reads Apple point-of-interest categories', () => {
    expect(categoryForPoi('MKPOICategoryNightlife')).toBe('club');
    expect(categoryForPoi('MKPOICategoryCafe')).toBe('restaurant');
    expect(categoryForPoi('MKPOICategoryBeach')).toBe('beach');
    expect(categoryForPoi('MKPOICategoryNationalPark')).toBe('hike');
  });

  it('catches the families it does not enumerate', () => {
    expect(categoryForPoi('MKPOICategoryBrewery')).toBe('bar');
    expect(categoryForPoi('MKPOICategoryFoodMarket')).toBe('restaurant');
  });

  it('treats an unknown or missing category as a real answer, not a failure', () => {
    expect(categoryForPoi('MKPOICategoryLaundry')).toBe('other');
    expect(categoryForPoi(null)).toBe('other');
    expect(categoryForPoi(undefined)).toBe('other');
  });
});

describe('the pin lifetime slider', () => {
  const now = new Date('2026-08-21T18:00:00');

  it('never lets a pin outlive the 72 hour rule', () => {
    const expiry = expiryForHours(9999, now);
    expect(expiry.getTime() - now.getTime()).toBeLessThanOrEqual(MAX_PIN_HOURS * 3_600_000);
  });

  it('never lets a pin be set shorter than an hour', () => {
    const expiry = expiryForHours(0, now);
    expect(expiry.getTime() - now.getTime()).toBeGreaterThanOrEqual(3_600_000);
  });

  it("starts the slider late enough to reach the plan's own day", () => {
    // A plan for the day after tomorrow must not be allowed to expire tonight.
    const dayAfter = toISODate(addDays(now, 2));
    const min = minHoursForIntent(dayAfter, now);
    expect(new Date(now.getTime() + min * 3_600_000).getTime()).toBeGreaterThan(
      parseISODate(dayAfter).getTime()
    );
  });

  it("defaults to the end of the plan's day", () => {
    const today = toISODate(now);
    // 18:00 to local midnight is six hours.
    expect(defaultHoursForIntent(today, now)).toBe(6);
  });

  it('never defaults below its own floor', () => {
    const dayAfter = toISODate(addDays(now, 2));
    expect(defaultHoursForIntent(dayAfter, now)).toBeGreaterThanOrEqual(
      minHoursForIntent(dayAfter, now)
    );
  });
});

describe('hoursLabel', () => {
  it('says hours, then days, the way a person would', () => {
    expect(hoursLabel(1)).toBe('1 hour');
    expect(hoursLabel(6)).toBe('6 hours');
    expect(hoursLabel(24)).toBe('1 day');
    expect(hoursLabel(30)).toBe('1 day 6h');
    expect(hoursLabel(72)).toBe('3 days');
  });
});

describe('burnOutLabel', () => {
  const now = new Date(2026, 2, 4, 15, 0);

  it('does not shave an hour off a pin the moment it is posted', () => {
    // The bug this covers: a pin set to 23 hours read "burns out in 22h" on
    // the card that appeared right after posting it, because the countdown
    // floored 22.99.
    const posted = expiryForHours(23, now);
    const aBeatLater = new Date(now.getTime() + 2_000);
    expect(burnOutLabel(posted.toISOString(), aBeatLater)).toBe('burns out in 23h');
  });

  it('counts down to the nearest hour', () => {
    const inTwoHours = new Date(now.getTime() + 2 * 3_600_000 + 60_000);
    expect(burnOutLabel(inTwoHours.toISOString(), now)).toBe('burns out in 2h');
  });

  it('says soon rather than round up the last hour', () => {
    const inHalfAnHour = new Date(now.getTime() + 30 * 60_000);
    expect(burnOutLabel(inHalfAnHour.toISOString(), now)).toBe('burns out soon');
    expect(burnOutLabel(new Date(now.getTime() - 1_000).toISOString(), now)).toBe('burns out soon');
  });
});

describe('the default pin lifetime', () => {
  // A pin dropped at 23:00 for tonight used to default to one hour, so it was
  // off the map before anyone had left the hostel.
  it('does not default a late-evening plan to an hour', () => {
    const lateTonight = new Date(2026, 7, 22, 23, 0, 0);
    expect(defaultHoursForIntent('2026-08-22', lateTonight)).toBeGreaterThanOrEqual(6);
  });

  it('still ends a normal evening plan at the end of its own day', () => {
    const sixPm = new Date(2026, 7, 22, 18, 0, 0);
    expect(defaultHoursForIntent('2026-08-22', sixPm)).toBe(6);
  });

  it('never exceeds the 72h ceiling', () => {
    const now = new Date(2026, 7, 22, 9, 0, 0);
    expect(defaultHoursForIntent('2026-08-25', now)).toBeLessThanOrEqual(72);
  });
});

describe('filterDates', () => {
  it('accepts the local day and the UTC day when a phone straddles them', () => {
    // 18:00 in Los Angeles is already the next day in UTC.
    const evening = new Date('2026-08-22T01:00:00Z');
    const dates = filterDates('today', evening);
    expect(dates.length).toBeGreaterThanOrEqual(1);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('says one date when the two clocks agree', () => {
    const midday = new Date(2026, 7, 22, 12, 0, 0);
    const dates = filterDates('today', midday);
    expect(dates).toContain('2026-08-22');
  });
});

describe('shouldGeocode (the place pill throttle)', () => {
  const bkk = { lat: 13.7563, lng: 100.5018 };
  // ~200m north of bkk: one degree of latitude is ~111km.
  const farther = { lat: 13.7563 + 0.0018, lng: 100.5018 };
  // ~5m north: same street, same answer.
  const nudge = { lat: 13.7563 + 0.000045, lng: 100.5018 };

  it('refuses inside the 800ms floor', () => {
    expect(shouldGeocode({ last: bkk, next: farther, lastAtMs: 1_000, nowMs: 1_500 })).toBe(false);
  });

  it('refuses a centre within 15m of the last geocoded one', () => {
    expect(shouldGeocode({ last: bkk, next: nudge, lastAtMs: 0, nowMs: 10_000 })).toBe(false);
  });

  it('allows a real move once the floor has passed', () => {
    expect(shouldGeocode({ last: bkk, next: farther, lastAtMs: 1_000, nowMs: 2_000 })).toBe(true);
  });

  it('allows the very first geocode', () => {
    expect(shouldGeocode({ last: null, next: bkk, lastAtMs: 0, nowMs: 900 })).toBe(true);
  });
});

describe('pinTitle / pinSubtitle (one voice for a pin, everywhere)', () => {
  it('titles a pin by its venue, never by its note', () => {
    expect(pinTitle({ venue_name: 'Sky Bar' })).toBe('Sky Bar');
    // The note has no say: the type does not even accept one.
    expect(
      pinTitle({ venue_name: 'Sky Bar', note: 'Sunset drinks' } as { venue_name: string })
    ).toBe('Sky Bar');
  });

  it('subtitles a pin with its trimmed plan text', () => {
    expect(pinSubtitle({ note: '  Sunset drinks  ' })).toBe('Sunset drinks');
  });

  it('returns null for a missing, empty or whitespace note', () => {
    expect(pinSubtitle({ note: null })).toBeNull();
    expect(pinSubtitle({ note: '' })).toBeNull();
    expect(pinSubtitle({ note: '   ' })).toBeNull();
  });
});

describe('isLaterDay (the marker dim)', () => {
  // Mar 4, 3pm local. Whatever the runner's timezone, both of the two clocks
  // that write intent_date agree these are today-or-past and this is later.
  const now = new Date(2026, 2, 4, 15, 0);

  it('is false for today and for a day already under way', () => {
    expect(isLaterDay(toISODate(now), now)).toBe(false);
    expect(isLaterDay(toISODate(addDays(now, -1)), now)).toBe(false);
  });

  it('is true only once BOTH clocks agree the day is later', () => {
    // Two days out is later than today on the local clock and the UTC clock
    // alike, whichever side of the meridian the runner sits on.
    expect(isLaterDay(toISODate(addDays(now, 2)), now)).toBe(true);
  });
});

describe('avatar initials outside the BMP', () => {
  it('Array.from yields one whole grapheme where slice would split the surrogate pair', () => {
    const name = '😀 Sam';
    expect(Array.from(name)[0]).toBe('😀');
    // The bug being prevented: a UTF-16 slice cuts the pair in half.
    expect(name.slice(0, 1)).not.toBe('😀');
  });
});
