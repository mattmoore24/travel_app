import {
  NO_INTENT_TIME,
  byIntentMoment,
  intentTimeLabel,
  whenLabel,
} from '@/features/pins/pin-helpers';

/**
 * The optional hour, and the one thing it is not allowed to become: a
 * presence claim (§7 rule 2). The sentence is "Today at 19:00", never
 * "here now".
 *
 * The hour is TYPED now (founder, round 4; typed-time.ts and its test read
 * the typing), so the rails of preset hours this file once bounded are gone
 * with their tests. What stays is how an hour prints and sorts, which is the
 * same whether it came off a chip or a keyboard.
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
    // The empty string is what an empty box carries, and it means the same
    // thing as null the moment it leaves the form.
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
