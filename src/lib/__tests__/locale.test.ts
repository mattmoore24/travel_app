/**
 * The locale helper reads the FIRST locale and the FIRST calendar, and every
 * value it exports has a fallback, because every one of them is nullable on
 * some platform. All three halves are worth pinning: reading `getLocales()[1]`
 * would silently follow the phone's second-choice language, an unfallen-back
 * null would put "undefined" into a date header, and an EMPTY array - which
 * the declared tuple type says cannot happen and no runtime promises - would
 * throw at module load and take the app down with it.
 */

const mockLocales = jest.fn();
const mockCalendars = jest.fn();

jest.mock('expo-localization', () => ({
  getLocales: () => mockLocales(),
  getCalendars: () => mockCalendars(),
}));

const load = () => {
  let mod: typeof import('@/lib/locale');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/lib/locale') as typeof import('@/lib/locale');
  });
  return mod!;
};

describe('the device locale', () => {
  it('reads the first locale and the first calendar', () => {
    mockLocales.mockReturnValue([
      { languageTag: 'pt-PT', languageCode: 'pt' },
      { languageTag: 'en-US', languageCode: 'en' },
    ]);
    mockCalendars.mockReturnValue([
      { uses24hourClock: true, firstWeekday: 2, timeZone: 'Europe/Lisbon' },
      { uses24hourClock: false, firstWeekday: 1, timeZone: 'UTC' },
    ]);
    const locale = load();
    expect(locale.DEVICE_LOCALE).toBe('pt-PT');
    expect(locale.DEVICE_LANGUAGE).toBe('pt');
    expect(locale.USES_24_HOUR_CLOCK).toBe(true);
    expect(locale.FIRST_WEEKDAY).toBe(2);
    expect(locale.DEVICE_TIME_ZONE).toBe('Europe/Lisbon');
  });

  it('falls back rather than exporting a null', () => {
    mockLocales.mockReturnValue([{ languageTag: '', languageCode: null }]);
    mockCalendars.mockReturnValue([{ uses24hourClock: null, firstWeekday: null, timeZone: null }]);
    const locale = load();
    expect(locale.DEVICE_LOCALE).toBe('en-US');
    expect(locale.DEVICE_LANGUAGE).toBe('en');
    expect(locale.USES_24_HOUR_CLOCK).toBe(false);
    expect(locale.FIRST_WEEKDAY).toBe(1);
    expect(locale.DEVICE_TIME_ZONE).toBe('UTC');
  });

  it('keeps a 12-hour phone on a 12-hour clock', () => {
    mockLocales.mockReturnValue([{ languageTag: 'en-US', languageCode: 'en' }]);
    mockCalendars.mockReturnValue([
      { uses24hourClock: false, firstWeekday: 1, timeZone: 'America/Los_Angeles' },
    ]);
    expect(load().USES_24_HOUR_CLOCK).toBe(false);
  });

  // The failure this pins is not a wrong date, it is a blank app:
  // expo-localization declares both getters as non-empty tuples, so `[0]`
  // type-checks as present and a platform that hands back `[]` throws a
  // TypeError while the module is still loading — before any of the field
  // fallbacks above can run, and before a screen mounts.
  it('survives a platform that knows nothing at all', () => {
    mockLocales.mockReturnValue([]);
    mockCalendars.mockReturnValue([]);
    const locale = load();
    expect(locale.DEVICE_LOCALE).toBe('en-US');
    expect(locale.DEVICE_LANGUAGE).toBe('en');
    expect(locale.USES_24_HOUR_CLOCK).toBe(false);
    expect(locale.FIRST_WEEKDAY).toBe(1);
    expect(locale.DEVICE_TIME_ZONE).toBe('UTC');
  });

  it('survives a phone with a locale but no calendar', () => {
    mockLocales.mockReturnValue([{ languageTag: 'pt-PT', languageCode: 'pt' }]);
    mockCalendars.mockReturnValue([]);
    const locale = load();
    expect(locale.DEVICE_LOCALE).toBe('pt-PT');
    expect(locale.DEVICE_TIME_ZONE).toBe('UTC');
  });
});
