import {
  MAX_WINDOW_MINUTES,
  parseTypedTime,
  readTypedTime,
  typedTimeHasPassed,
  windowMinutes,
} from '@/features/pins/typed-time';

/**
 * The time on a pin, typed.
 *
 * Founder, round 4: the start and the end are typed and optional, the preset
 * hour buttons go, and small text says the times are the destination's own.
 * Reading what somebody typed is the part that can quietly lie, so it is the
 * part with a table: generous on the shapes a thumb produces, and a refusal,
 * never a rounding, on anything that is not a time.
 */

/**
 * typed-time with the phone set one way or the other, so the one honest
 * ambiguity (a bare hour) can be asserted on each clock. Same isolation as
 * a-pin-carries-an-hour.test.ts: lib/locale reads expo-localization once at
 * load and memoises the formatter behind it.
 */
function typedTimeOn(uses24hourClock: boolean) {
  let mod: typeof import('@/features/pins/typed-time') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
      getCalendars: () => [{ uses24hourClock, firstWeekday: 1, timeZone: 'UTC' }],
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/features/pins/typed-time') as typeof import('@/features/pins/typed-time');
  });
  jest.dontMock('expo-localization');
  return mod!;
}

describe('reading a typed time', () => {
  // Every row reads the same on a 12-hour and a 24-hour phone: an AM or PM
  // says which half of the day, and an hour past twelve can only be one.
  it.each([
    ['7pm', '19:00'],
    ['7 PM', '19:00'],
    ['7 p.m.', '19:00'],
    ['7:30pm', '19:30'],
    ['7.30 pm', '19:30'],
    ['7:30 am', '07:30'],
    ['12:30am', '00:30'],
    ['19:30', '19:30'],
    ['1930', '19:30'],
    ['19h30', '19:30'],
    ['13', '13:00'],
    ['0', '00:00'],
    ['0:30', '00:30'],
    ['00', '00:00'],
    ['23:59', '23:59'],
    ['12am', '00:00'],
    ['12 pm', '12:00'],
    ['noon', '12:00'],
    ['midnight', '00:00'],
    [' 7:30 PM ', '19:30'],
    ['7p', '19:00'],
    ['11a', '11:00'],
  ])('reads %p as %p on either clock', (typed, expected) => {
    expect(typedTimeOn(false).parseTypedTime(typed)).toBe(expected);
    expect(typedTimeOn(true).parseTypedTime(typed)).toBe(expected);
  });

  it.each([
    'seven',
    '24',
    '25:00',
    '7:60',
    '13pm',
    '0am',
    'pm',
    '7:3',
    '7::30',
    'tonight',
    '7pm-ish',
    '7 pm tonight',
  ])('refuses %p rather than guess', (typed) => {
    expect(readTypedTime(typed)).toEqual({ problem: 'unreadable' });
    expect(parseTypedTime(typed)).toBeNull();
  });

  it('reads a blank box as no hour, which is an answer', () => {
    expect(readTypedTime('')).toBeNull();
    expect(readTypedTime('   ')).toBeNull();
  });
});

describe('the bare hour, the one honest ambiguity', () => {
  it('is the morning on a 24-hour phone, where that is what "7" means', () => {
    const on24 = typedTimeOn(true);
    expect(on24.parseTypedTime('7')).toBe('07:00');
    expect(on24.parseTypedTime('7:30')).toBe('07:30');
    expect(on24.parseTypedTime('12')).toBe('12:00');
  });

  it('asks for AM or PM on a 12-hour phone, whose box says "7:30 PM"', () => {
    // "7" for drinks would have posted the morning. Not read, and the form
    // says how; nothing is guessed.
    const on12 = typedTimeOn(false);
    expect(on12.readTypedTime('7')).toEqual({ problem: 'meridiem' });
    expect(on12.readTypedTime('7:30')).toEqual({ problem: 'meridiem' });
    expect(on12.readTypedTime('12')).toEqual({ problem: 'meridiem' });
    // Zero and anything past twelve are not ambiguous on any clock.
    expect(on12.parseTypedTime('0')).toBe('00:00');
    expect(on12.parseTypedTime('13')).toBe('13:00');
  });

  it('in the END box is read against the start, on either clock', () => {
    for (const mod of [typedTimeOn(false), typedTimeOn(true)]) {
      // "7pm to 11" is eleven at night; "9am to 11" is eleven in the morning.
      expect(mod.parseTypedTime('11', '19:00')).toBe('23:00');
      expect(mod.parseTypedTime('11', '09:00')).toBe('11:00');
      // "10pm to 2" crosses midnight: neither two is after the start, so it
      // is the earlier one, tomorrow morning.
      expect(mod.parseTypedTime('2', '22:00')).toBe('02:00');
      // "9am to 5" is the afternoon, minutes and all.
      expect(mod.parseTypedTime('5:30', '09:00')).toBe('17:30');
      // Twelve after a morning start is noon; after an evening one, midnight.
      expect(mod.parseTypedTime('12', '09:00')).toBe('12:00');
      expect(mod.parseTypedTime('12', '19:00')).toBe('00:00');
      // An AM or PM in the end box is taken at its word.
      expect(mod.parseTypedTime('11am', '19:00')).toBe('11:00');
    }
  });
});

describe('the examples the boxes show', () => {
  it('follow the phone, through the one clock', () => {
    // Never hardcoded: the example and the readout come off the same
    // formatter (lib/locale), so they cannot disagree about AM and PM.
    expect(typedTimeOn(false).typedTimeExample()).toBe('7:30 PM');
    expect(typedTimeOn(true).typedTimeExample()).toBe('19:30');
    expect(typedTimeOn(false).typedTimeUntilExample()).toBe('10:00 PM');
    expect(typedTimeOn(true).typedTimeUntilExample()).toBe('22:00');
  });
});

describe('how long a window is', () => {
  it('counts across midnight, the way the server reads an end before its start', () => {
    expect(windowMinutes('19:00', '22:00')).toBe(180);
    expect(windowMinutes('22:00', '02:00')).toBe(240);
    expect(windowMinutes('19:00', '19:00')).toBe(0);
    // A typo short of a day is a day, not a window.
    expect(windowMinutes('19:00', '18:59')).toBe(24 * 60 - 1);
    expect(windowMinutes('19:00', '18:59')).toBeGreaterThan(MAX_WINDOW_MINUTES);
    expect(windowMinutes('09:00', '21:00')).toBe(MAX_WINDOW_MINUTES);
  });
});

describe('a time the city has already passed', () => {
  // Ten in the morning, on a device whose clock is the browsed city's.
  const tenInTheMorning = new Date(2026, 8, 1, 10, 0);

  it('is gone on the plan day when it is at or behind the city clock', () => {
    expect(typedTimeHasPassed('09:59', '2026-09-01', tenInTheMorning)).toBe(true);
    expect(typedTimeHasPassed('10:00', '2026-09-01', tenInTheMorning)).toBe(true);
    expect(typedTimeHasPassed('10:01', '2026-09-01', tenInTheMorning)).toBe(false);
  });

  it('is never gone on a later day, and always on an earlier one', () => {
    expect(typedTimeHasPassed('00:00', '2026-09-02', tenInTheMorning)).toBe(false);
    expect(typedTimeHasPassed('23:59', '2026-08-31', tenInTheMorning)).toBe(true);
  });

  // The map is city-scoped and its whole use case is a city you have not
  // reached yet, so the clock the typed time is held against is the CITY's.
  it('reads the city clock, not the device one', () => {
    const cityClock = new Date(2026, 8, 1, 13, 0); // three hours ahead
    expect(typedTimeHasPassed('12:00', '2026-09-01', cityClock)).toBe(true);
    expect(typedTimeHasPassed('14:00', '2026-09-01', cityClock)).toBe(false);
  });
});
