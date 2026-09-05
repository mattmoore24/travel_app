import {
  NO_INTENT_TIME,
  byIntentMoment,
  intentTimeLabel,
  intentEndOptions,
  intentTimeOptions,
  whenLabel,
} from '@/features/pins/pin-helpers';

/**
 * The optional hour, and the two things it is not allowed to become.
 *
 * It must not be a way around the 72-hour ceiling (§7 rule 3): the form may
 * only offer hours that fall inside the pin's own lifetime, which is the
 * client half of the comparison validate_pin makes exactly, in the city's
 * zone, against expires_at. And it must not be a presence claim (§7 rule 2):
 * the sentence is "Today at 19:00", never "here now".
 */

/**
 * pin-helpers with the phone set one way or the other, so the hour's FORMAT
 * can be asserted rather than assumed. The module is re-required inside the
 * isolation because lib/locale reads expo-localization once at load and
 * memoises the formatter behind it.
 */
function helpersOn(uses24hourClock: boolean) {
  let mod: typeof import('@/features/pins/pin-helpers') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo-localization', () => ({
      getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
      getCalendars: () => [{ uses24hourClock, firstWeekday: 1, timeZone: 'UTC' }],
    }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/features/pins/pin-helpers') as typeof import('@/features/pins/pin-helpers');
  });
  jest.dontMock('expo-localization');
  return mod!;
}

describe('the hour a pin prints', () => {
  it('follows the phone rather than pinning a format', () => {
    expect(helpersOn(true).intentTimeLabel('19:00:00')).toBe('19:00');
    expect(helpersOn(false).intentTimeLabel('19:00:00')).toBe('7:00 PM');
  });

  it('is nothing at all when the plan named none', () => {
    expect(intentTimeLabel(null)).toBeNull();
    expect(intentTimeLabel(undefined)).toBeNull();
    // The empty string is what the "Any time" chip carries, and it means the
    // same thing as null the moment it leaves the form.
    expect(intentTimeLabel(NO_INTENT_TIME)).toBeNull();
  });
});

describe('when a plan is, in one line', () => {
  const clock = new Date(2026, 8, 1, 10, 0);

  it('says the day alone when there is no hour', () => {
    expect(whenLabel({ intent_date: '2026-09-01', intent_time: null }, clock)).toBe('Today');
  });

  it('joins the two with "at", which is a plan and not a place somebody is', () => {
    const line = helpersOn(true).whenLabel(
      { intent_date: '2026-09-01', intent_time: '19:00:00' },
      clock
    );
    expect(line).toBe('Today at 19:00');
    // The banned grammar, spelled out so a rewrite has to trip over it.
    expect(line).not.toMatch(/here|now|nearby/i);
  });

  it('carries the hour onto tomorrow too', () => {
    expect(
      helpersOn(true).whenLabel({ intent_date: '2026-09-02', intent_time: '08:30:00' }, clock)
    ).toBe('Tomorrow at 08:30');
  });
});

describe('sorting a stack of plans', () => {
  const at = (date: string, time: string | null) => ({ intent_date: date, intent_time: time });

  it('puts the earlier day first', () => {
    expect(byIntentMoment(at('2026-09-01', null), at('2026-09-02', null))).toBeLessThan(0);
  });

  it('puts the earlier hour first inside one day', () => {
    expect(byIntentMoment(at('2026-09-01', '09:00'), at('2026-09-01', '19:00'))).toBeLessThan(0);
  });

  it('puts a plan with no hour after the ones that named one', () => {
    expect(byIntentMoment(at('2026-09-01', null), at('2026-09-01', '19:00'))).toBeGreaterThan(0);
    expect(byIntentMoment(at('2026-09-01', '19:00'), at('2026-09-01', null))).toBeLessThan(0);
  });

  it('leaves two identical plans alone', () => {
    expect(byIntentMoment(at('2026-09-01', '19:00'), at('2026-09-01', '19:00'))).toBe(0);
    expect(byIntentMoment(at('2026-09-01', null), at('2026-09-01', null))).toBe(0);
  });

  it('sorts a real stack the way somebody reads it', () => {
    const stack = [
      at('2026-09-01', null),
      at('2026-09-02', '09:00'),
      at('2026-09-01', '19:00'),
      at('2026-09-01', '09:00'),
    ];
    expect([...stack].sort(byIntentMoment)).toEqual([
      at('2026-09-01', '09:00'),
      at('2026-09-01', '19:00'),
      at('2026-09-01', null),
      at('2026-09-02', '09:00'),
    ]);
  });
});

describe('a window and a TBD', () => {
  const clock = new Date(2026, 8, 1, 10, 0);

  it('says a window as "from, to", after the day', () => {
    expect(
      helpersOn(true).whenLabel(
        { intent_date: '2026-09-01', intent_time: '19:00:00', intent_time_end: '22:00:00' },
        clock
      )
    ).toBe('Today, 19:00 to 22:00');
  });

  it('says TBD as an answer, not as silence', () => {
    expect(whenLabel({ intent_date: '2026-09-01', intent_time: null, time_tbd: true }, clock)).toBe(
      'Today, time TBD'
    );
    expect(whenLabel({ intent_date: '2026-09-01', intent_time: null }, clock)).toBe('Today');
  });

  it('the time part alone, for surfaces that print the day elsewhere', () => {
    const h = helpersOn(true);
    expect(h.timeWindowLabel({ intent_time: null })).toBeNull();
    expect(h.timeWindowLabel({ intent_time: '19:00:00' })).toBe('19:00');
    expect(h.timeWindowLabel({ intent_time: '22:00:00', intent_time_end: '02:00:00' })).toBe(
      '22:00 to 02:00'
    );
    expect(h.timeWindowLabel({ time_tbd: true })).toBe('time TBD');
  });
});

describe('which hours a window may end at', () => {
  const now = new Date(2026, 8, 1, 10, 0);

  it('the hours after the start, past midnight included, eight at most', () => {
    const options = intentEndOptions('2026-09-01', '22:00', new Date(2026, 8, 3, 10, 0), now, now);
    expect(options.map((option) => option.value)).toEqual([
      '23:00',
      '00:00',
      '01:00',
      '02:00',
      '03:00',
      '04:00',
      '05:00',
      '06:00',
    ]);
  });

  // THE RULE 3 EDGE, for the end of a window: an end after the pin's own
  // expiry is a chip that posts an error, so it is not offered.
  it('stops at the moment the pin itself disappears', () => {
    const options = intentEndOptions('2026-09-01', '19:00', new Date(2026, 8, 1, 21, 0), now, now);
    expect(options.map((option) => option.value)).toEqual(['20:00', '21:00']);
  });

  it('measures that ceiling on the city clock, not the device one', () => {
    const cityClock = new Date(2026, 8, 1, 13, 0); // three hours ahead
    const expiresAt = new Date(2026, 8, 1, 14, 0); // device time
    // 14:00 device = 17:00 city; a 15:00 start may end at 16:00 or 17:00.
    const options = intentEndOptions('2026-09-01', '15:00', expiresAt, cityClock, now);
    expect(options.map((option) => option.value)).toEqual(['16:00', '17:00']);
  });

  it('answers nothing for a start it cannot read', () => {
    expect(intentEndOptions('2026-09-01', 'tbd', new Date(2026, 8, 3), now, now)).toEqual([]);
  });
});

describe('which hours the form may offer', () => {
  // Ten in the morning, on a device whose clock is the browsed city's.
  const now = new Date(2026, 8, 1, 10, 0);

  it('offers hours and nothing that means "unset": the form starts dark', () => {
    // The founder: "an optional field, not a preselected bubble". TBD is
    // the form's own chip beside these, not an option this helper invents.
    const options = intentTimeOptions('2026-09-01', new Date(2026, 8, 1, 16, 0), now, now);
    expect(options.map((option) => option.value)).not.toContain(NO_INTENT_TIME);
    expect(options.map((option) => option.label)).not.toContain('Any time');
  });

  it('never offers an hour that has already gone on the city clock', () => {
    const options = intentTimeOptions('2026-09-01', new Date(2026, 8, 1, 16, 0), now, now);
    expect(options.map((option) => option.value)).toEqual([
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
    ]);
  });

  // THE RULE 3 EDGE, on the client side of it. A pin that burns out at four
  // must not offer eight in the evening: the database refuses that outright,
  // so a chip for it would be a control that posts an error.
  it('stops at the moment the pin itself disappears', () => {
    const options = intentTimeOptions('2026-09-01', new Date(2026, 8, 1, 16, 0), now, now);
    expect(options.map((option) => option.value)).not.toContain('17:00');
    expect(options.map((option) => option.value)).not.toContain('23:00');
  });

  it('offers the whole of a later day, up to that same ceiling', () => {
    const options = intentTimeOptions('2026-09-02', new Date(2026, 8, 2, 16, 0), now, now);
    expect(options[0]).toEqual(expect.objectContaining({ value: '00:00' }));
    expect(options[options.length - 1]).toEqual(expect.objectContaining({ value: '16:00' }));
  });

  it('offers nothing when no hour is left in the day, so the rail stays down', () => {
    const lateNight = new Date(2026, 8, 1, 23, 30);
    const options = intentTimeOptions(
      '2026-09-01',
      new Date(2026, 8, 2, 2, 0),
      lateNight,
      lateNight
    );
    expect(options).toEqual([]);
  });

  // The map is city-scoped and its whole use case is a city you have not
  // reached yet, so the hours offered are the CITY's, measured against a
  // lifetime that is an absolute instant.
  it('reads the hours off the browsed city clock, not the device one', () => {
    const cityClock = new Date(2026, 8, 1, 13, 0); // three hours ahead
    const expiresAt = new Date(2026, 8, 1, 14, 0); // four device-hours away
    const options = intentTimeOptions('2026-09-01', expiresAt, cityClock, now);
    expect(options.map((option) => option.value)).toEqual(['14:00', '15:00', '16:00', '17:00']);
  });
});
