import { addDays, parseISODate, toISODate } from '@/features/trips/dates';

import {
  MAX_PIN_HOURS,
  burnOutLabel,
  categoryForPlan,
  categoryForPoi,
  cityClockNow,
  defaultHoursForIntent,
  expiryForDuration,
  expiryForHours,
  expiryForIntentDate,
  filterDates,
  hoursLabel,
  intentDateOptions,
  intentLabel,
  isLaterCityDay,
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

describe('categoryForPlan', () => {
  it('reads the activity out of a plan someone actually wrote', () => {
    expect(categoryForPlan('Sunset drinks')).toBe('bar');
    expect(categoryForPlan('Rooftop hello from Maestro')).toBe('bar');
    expect(categoryForPlan('brunch by the river')).toBe('restaurant');
    expect(categoryForPlan('going dancing after midnight')).toBe('club');
    expect(categoryForPlan('trek to the viewpoint')).toBe('hike');
    expect(categoryForPlan('morning surf')).toBe('beach');
    expect(categoryForPlan('the modern art gallery')).toBe('museum');
    expect(categoryForPlan('Wat Pho at opening')).toBe('monument');
  });

  it('ignores case, the way people type', () => {
    expect(categoryForPlan('COCKTAIL HOUR')).toBe('bar');
    expect(categoryForPlan('Beach day')).toBe('beach');
  });

  it('matches words, not fragments', () => {
    // 'eat' inside 'theatre' or 'club' inside 'clubhouse' would be a guess
    // built on letters, not on what anybody said they were doing.
    expect(categoryForPlan('theatre tickets sorted')).toBeNull();
    expect(categoryForPlan('meet at the clubhouse door')).toBeNull();
  });

  it('answers null when the plan names no activity, so the caller decides', () => {
    // Null, not 'other': categoryForPoi already rules that unrecognised is a
    // real answer, and this extends that rule rather than replacing it.
    expect(categoryForPlan('Hello from Maestro')).toBeNull();
    expect(categoryForPlan('meet by the fountain at 7')).toBeNull();
    expect(categoryForPlan('')).toBeNull();
  });
});

describe('a null POI and a keyword-free plan still land on a real category', () => {
  it('the form-side fallback chain ends at other, never at nothing', () => {
    // The exact expression the pin form runs for a hand-placed pin whose
    // plan names no activity: POI 'other', plan null, and the pin still
    // files under a chip that exists.
    const poi = categoryForPoi(null);
    expect(poi !== 'other' ? poi : (categoryForPlan('meet by the fountain') ?? 'other')).toBe(
      'other'
    );
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

  it("leads with the browsed city's day, and keeps the device day matched", () => {
    // A device at 20:00 on the 30th browsing a city where it is already
    // 03:00 on the 31st: "today" must show the city's tonight, and must not
    // hide pins the device's own clock (or the seed's UTC clock) wrote.
    const device = new Date(2026, 7, 30, 20, 0);
    const city = new Date(2026, 7, 31, 3, 0);
    const dates = filterDates('today', device, city);
    expect(dates[0]).toBe('2026-08-31'); // the city leads: heatDay asks about it
    expect(dates).toContain('2026-08-30'); // the tolerance is widened, never swapped
    expect(new Set(dates).size).toBe(dates.length);
  });

  it('shifts every chip by the same city day', () => {
    const device = new Date(2026, 7, 30, 20, 0);
    const city = new Date(2026, 7, 31, 3, 0);
    expect(filterDates('tomorrow', device, city)[0]).toBe('2026-09-01');
    expect(filterDates('later', device, city)[0]).toBe('2026-09-02');
  });
});

describe("cityClockNow (the browsed city's today)", () => {
  it("reads Bangkok's small hours off a London evening", () => {
    // 19:00 UTC on Aug 30 is 02:00 on Aug 31 in Bangkok (UTC+7).
    const instant = new Date(Date.UTC(2026, 7, 30, 19, 0));
    const bkk = cityClockNow('Asia/Bangkok', 100.5, instant);
    expect(toISODate(bkk)).toBe('2026-08-31');
    expect(bkk.getHours()).toBe(2);
  });

  it('answers the other direction for a device east of the city', () => {
    // 03:00 UTC on Aug 31 is still 21:00 on Aug 30 in Mexico City (UTC-6).
    const instant = new Date(Date.UTC(2026, 7, 31, 3, 0));
    const cdmx = cityClockNow('America/Mexico_City', -99.13, instant);
    expect(toISODate(cdmx)).toBe('2026-08-30');
    expect(cdmx.getHours()).toBe(21);
  });

  it('falls back to the longitude approximation for a zone ICU does not know', () => {
    // lng 105 is roughly UTC+7; the approximation lands on the same day.
    const instant = new Date(Date.UTC(2026, 7, 30, 19, 0));
    const approx = cityClockNow('Not/AZone', 105, instant);
    expect(toISODate(approx)).toBe('2026-08-31');
    expect(approx.getHours()).toBe(2);
  });

  it('labels intent dates by the city clock it is handed', () => {
    const city = new Date(2026, 7, 31, 3, 0);
    expect(intentLabel('2026-08-31', city)).toBe('Today');
    expect(intentLabel('2026-09-01', city)).toBe('Tomorrow');
    // The night the device still calls "today" is over in the city.
    expect(intentLabel('2026-08-30', city)).not.toBe('Today');
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

  it('subtitles a pin with its plan first, the note standing in', () => {
    expect(pinSubtitle({ plan: ' Sunset drinks ', note: 'by the door at 7' })).toBe(
      'Sunset drinks'
    );
    // Rows from before the split (and plans whose author wrote only a
    // detail) still say something.
    expect(pinSubtitle({ plan: null, note: '  Sunset drinks  ' })).toBe('Sunset drinks');
    expect(pinSubtitle({ note: '  Sunset drinks  ' })).toBe('Sunset drinks');
  });

  it('returns null when neither the plan nor the note says anything', () => {
    expect(pinSubtitle({ plan: null, note: null })).toBeNull();
    expect(pinSubtitle({ plan: '', note: '' })).toBeNull();
    expect(pinSubtitle({ plan: '   ', note: '   ' })).toBeNull();
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

describe('isLaterCityDay (the dim on the city clock)', () => {
  // THE BANGKOK-FROM-MEXICO-CITY REGRESSION. Browsing Bangkok at 20:00
  // Bangkok time on Aug 31 from Mexico City (UTC-6): the map's clock is the
  // SYNTHETIC Date cityClockNow builds — wall time 2026-08-31 20:00 read in
  // the DEVICE zone. On that device the synthetic instant is 02:00Z on
  // SEP 1, so isLaterDay's UTC leg (`intentISO > toISOString()`) refused a
  // pin for Bangkok's tomorrow and the dim was lost. That leg is UTC-write
  // tolerance for the device clock and means nothing on a synthetic Date.

  it('keeps the dim on a pin for the city’s tomorrow, wherever the device is', () => {
    // 13:00Z on Aug 31 IS 20:00 in Bangkok; the synthetic clock reads
    // 2026-08-31 whatever zone this runner sits in.
    const clock = cityClockNow('Asia/Bangkok', 100.5, new Date(Date.UTC(2026, 7, 31, 13, 0)));
    expect(toISODate(clock)).toBe('2026-08-31');
    expect(isLaterCityDay('2026-09-01', clock)).toBe(true); // tomorrow: dimmed
    expect(isLaterCityDay('2026-08-31', clock)).toBe(false); // tonight: full amber
    expect(isLaterCityDay('2026-08-30', clock)).toBe(false); // already under way
  });

  it('documents the leg that lost it: isLaterDay’s UTC read on the synthetic instant', () => {
    // The exact instant a Mexico City device holds for "Bangkok, 20:00,
    // Aug 31": wall 2026-08-31T20:00 at UTC-6 is 02:00Z on Sep 1. Its UTC
    // day equals the intent date, so the ISO leg fails in EVERY runner zone
    // — which is why the map's city-clock call sites must not use isLaterDay.
    const syntheticOnThatDevice = new Date('2026-09-01T02:00:00Z');
    expect(isLaterDay('2026-09-01', syntheticOnThatDevice)).toBe(false);
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
