import { addDays, formatDate, toISODate } from '@/features/trips/dates';

import {
  MAX_TAKE_DOWN_DAYS,
  categoryForPlan,
  categoryForPoi,
  cityClockNow,
  effectiveTakeDown,
  intentLabel,
  isLaterCityDay,
  isLaterDay,
  pinSubtitle,
  pinTitle,
  shouldGeocode,
  takeDownBounds,
  takeDownDayFor,
  takeDownLabel,
} from '../pin-helpers';

describe('the day a pin comes down (hard rule 3: the traveler picks it, a year at most)', () => {
  // Three in the afternoon on Sep 10, on the CITY's clock.
  const city = new Date(2026, 8, 10, 15, 0);

  it("defaults to the plan's own day", () => {
    expect(effectiveTakeDown(null, '2026-09-18', city)).toBe('2026-09-18');
  });

  it('keeps a day BEFORE the plan exactly as picked', () => {
    // The founder's overrule (2026-09-10), as an assertion: there is no
    // floor at the plan's day. Somebody planning ahead may not want to be
    // messaged about it all the way up to the event.
    expect(effectiveTakeDown('2026-09-14', '2026-09-18', city)).toBe('2026-09-14');
  });

  it("floors at the city's today, so a sheet left open across midnight cannot post a dead day", () => {
    expect(effectiveTakeDown('2026-09-09', '2026-09-18', city)).toBe('2026-09-10');
    expect(effectiveTakeDown(null, '2026-09-09', city)).toBe('2026-09-10');
  });

  it('offers today to exactly a year out, and ceilings a pick past it', () => {
    const { minISO, maxISO } = takeDownBounds(city);
    expect(minISO).toBe('2026-09-10');
    expect(maxISO).toBe(toISODate(addDays(city, MAX_TAKE_DOWN_DAYS)));
    expect(maxISO).toBe('2027-09-10');
    // One looser than this in the trigger (+366), so the form can never
    // offer a day the server refuses.
    expect(effectiveTakeDown('2028-01-01', '2026-09-18', city)).toBe(maxISO);
  });

  it('labels intent dates for humans', () => {
    const now = new Date(2026, 2, 4, 12, 0);
    expect(intentLabel(toISODate(now), now)).toBe('Today');
    expect(intentLabel(toISODate(addDays(now, 1)), now)).toBe('Tomorrow');
    expect(intentLabel('2026-03-06', now)).toContain('Friday');
  });

  it('prints the year once it is not the current one', () => {
    // A pin can be up for a year now, so a plan eleven months out must not
    // render as an unqualified weekday: the rule formatDate already follows.
    const now = new Date(2026, 8, 10, 12, 0);
    expect(intentLabel('2027-08-06', now)).toContain('2027');
    expect(intentLabel('2027-08-06', now)).not.toContain('Friday');
    expect(intentLabel('2026-09-18', now)).toContain('Friday');
    expect(intentLabel('2026-09-18', now)).not.toContain('2026');
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

describe('takeDownLabel', () => {
  const now = new Date(2026, 2, 4, 15, 0);

  it('does not shave an hour off a pin the moment it is posted', () => {
    // The bug this covers: a pin with 23 hours left read "burns out in 22h"
    // on the card that appeared right after posting it, because the
    // countdown floored 22.99.
    const posted = new Date(now.getTime() + 23 * 3_600_000).toISOString();
    const aBeatLater = new Date(now.getTime() + 2_000);
    expect(takeDownLabel('2026-03-05', posted, aBeatLater)).toBe('burns out in 23h');
  });

  it('counts down to the nearest hour inside the last day', () => {
    const inTwoHours = new Date(now.getTime() + 2 * 3_600_000 + 60_000).toISOString();
    expect(takeDownLabel('2026-03-04', inTwoHours, now)).toBe('burns out in 2h');
  });

  it('says soon rather than round up the last hour', () => {
    const inHalfAnHour = new Date(now.getTime() + 30 * 60_000).toISOString();
    expect(takeDownLabel('2026-03-04', inHalfAnHour, now)).toBe('burns out soon');
    expect(takeDownLabel('2026-03-04', new Date(now.getTime() - 1_000).toISOString(), now)).toBe(
      'burns out soon'
    );
  });

  it('names the day beyond the last day, from take_down_on and never from the timestamp', () => {
    const inThreeDays = new Date(now.getTime() + 3 * 86_400_000).toISOString();
    expect(takeDownLabel('2026-03-07', inThreeDays, now)).toBe(
      `up until ${formatDate('2026-03-07')}`
    );
    // The column is what prints. A reader whose zone would round the same
    // instant onto another date still sees the day the author picked.
    expect(takeDownLabel('2026-03-08', inThreeDays, now)).toBe(
      `up until ${formatDate('2026-03-08')}`
    );
  });

  it('carries the year once it is not this one', () => {
    const inAYear = new Date(now.getTime() + 300 * 86_400_000).toISOString();
    expect(takeDownLabel('2030-03-07', inAYear, now)).toContain('2030');
  });
});

describe('takeDownDayFor (the day, read off an expiry in the city clock)', () => {
  it("reads Bangkok's take-down day off midnight at the end of it", () => {
    // Midnight at the end of Sep 18 in Bangkok (UTC+7) is 17:00Z on Sep 18;
    // converted in a London or New York zone that instant is still Sep 18,
    // but in Auckland it is Sep 19. The city's own clock says Sep 18.
    expect(takeDownDayFor('2026-09-18T17:00:00Z', 100.5)).toBe('2026-09-18');
  });

  it('answers the other direction for a city west of Greenwich', () => {
    // Midnight at the end of Sep 18 in Mexico City (UTC-6) is 06:00Z on
    // Sep 19, which a Bangkok reader would print as Sep 19.
    expect(takeDownDayFor('2026-09-19T06:00:00Z', -99.13)).toBe('2026-09-18');
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
