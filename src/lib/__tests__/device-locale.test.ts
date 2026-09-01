/**
 * The phone's language, on its way to a moderation verdict.
 *
 * The rule this file exists to pin is the one the founder question turns on:
 * a MISSING locale falls back to null, and null means English. It must never
 * fall back to a nearest guess. The phone's tag is not necessarily a language
 * the person reads well, and a guess built from a region or a name is how
 * somebody gets a rejection about their own face in a language they do not
 * speak, from an app that was sure it knew better.
 *
 * That is also why this reads `DEVICE_LOCALE_TAG` from lib/locale rather than
 * `DEVICE_LOCALE`: the same file answers the same question twice, once with a
 * fallback for formatters and once without for people, and the test below
 * that puts the two side by side is the one that would catch a future
 * `import { DEVICE_LOCALE }` here.
 */

const mockLocales = jest.fn();
const mockEq = jest.fn();
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ update: mockUpdate }));

jest.mock('expo-localization', () => ({
  getLocales: () => mockLocales(),
  getCalendars: () => [{}],
}));

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { from: (...args: unknown[]) => mockFrom(...(args as [])) },
}));

/**
 * Loaded fresh for every case, because the tag now comes from lib/locale,
 * which asks the phone once at module load and freezes the answer for the
 * process. A fresh module is also a fresh per-launch guard, which is what
 * `writtenFor` is: one launch, one module, one write.
 */
function load(): typeof import('@/lib/device-locale') {
  let mod: typeof import('@/lib/device-locale') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@/lib/device-locale') as typeof import('@/lib/device-locale');
  });
  return mod!;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEq.mockResolvedValue({ error: null });
});

describe('deviceLocaleTag', () => {
  it('reads the first locale, region included', () => {
    mockLocales.mockReturnValue([{ languageTag: 'th-TH' }, { languageTag: 'en-US' }]);
    expect(load().deviceLocaleTag()).toBe('th-TH');
  });

  it('answers null when the phone reports no tag, rather than guessing English', () => {
    mockLocales.mockReturnValue([{ languageCode: 'th' }]);
    expect(load().deviceLocaleTag()).toBeNull();
  });

  it('answers null when the phone reports nothing at all', () => {
    mockLocales.mockReturnValue([]);
    expect(load().deviceLocaleTag()).toBeNull();
  });

  it('answers null for an empty or oversized tag rather than writing one the column refuses', () => {
    mockLocales.mockReturnValue([{ languageTag: '   ' }]);
    expect(load().deviceLocaleTag()).toBeNull();
    mockLocales.mockReturnValue([{ languageTag: 'x'.repeat(17) }]);
    expect(load().deviceLocaleTag()).toBeNull();
  });

  // The two answers lib/locale gives to "what language is this phone", side by
  // side. A formatter must have SOME locale, so 'en-US' is the right default
  // there; a sentence addressed to a person must not be written in a language
  // guessed on their behalf. Reading the wrong one here would type-check, pass
  // every test above, and put an English rejection in front of a Thai reader.
  it('takes the answer that does not fall back, not the formatter one', () => {
    mockLocales.mockReturnValue([{ languageTag: '' }]);
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const locale = require('@/lib/locale') as typeof import('@/lib/locale');
      const deviceLocale = require('@/lib/device-locale') as typeof import('@/lib/device-locale');
      /* eslint-enable @typescript-eslint/no-require-imports */
      expect(locale.DEVICE_LOCALE).toBe('en-US');
      expect(locale.DEVICE_LOCALE_TAG).toBe('');
      expect(deviceLocale.deviceLocaleTag()).toBeNull();
    });
  });
});

describe('writeDeviceLocale', () => {
  it('writes the tag against the account that signed in', async () => {
    mockLocales.mockReturnValue([{ languageTag: 'pt-PT' }]);
    await load().writeDeviceLocale('u1');
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(mockUpdate).toHaveBeenCalledWith({ locale: 'pt-PT' });
    expect(mockEq).toHaveBeenCalledWith('user_id', 'u1');
  });

  it('writes null when there is nothing to write, which clears a stale one', async () => {
    mockLocales.mockReturnValue([{}]);
    await load().writeDeviceLocale('u1');
    expect(mockUpdate).toHaveBeenCalledWith({ locale: null });
  });

  it('does it once per launch, not once per auth event', async () => {
    mockLocales.mockReturnValue([{ languageTag: 'en-GB' }]);
    const launch = load();
    await launch.writeDeviceLocale('u1');
    await launch.writeDeviceLocale('u1');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('still writes when a different account signs in', async () => {
    mockLocales.mockReturnValue([{ languageTag: 'en-GB' }]);
    const launch = load();
    await launch.writeDeviceLocale('u1');
    await launch.writeDeviceLocale('u2');
    expect(mockEq).toHaveBeenNthCalledWith(2, 'user_id', 'u2');
  });

  it('lets the next attempt try again after a failure, and never throws', async () => {
    mockLocales.mockReturnValue([{ languageTag: 'en-GB' }]);
    mockEq.mockResolvedValueOnce({ error: { message: 'offline' } });
    const launch = load();
    await expect(launch.writeDeviceLocale('u1')).resolves.toBeUndefined();
    await launch.writeDeviceLocale('u1');
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it('swallows a thrown client error too', async () => {
    mockLocales.mockReturnValue([{ languageTag: 'en-GB' }]);
    mockEq.mockRejectedValueOnce(new Error('network'));
    await expect(load().writeDeviceLocale('u1')).resolves.toBeUndefined();
  });
});
