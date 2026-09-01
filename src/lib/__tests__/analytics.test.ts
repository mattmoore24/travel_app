/**
 * The no-op path is the dangerous one: without a key, `client` is null and
 * every capture() must stay a silent no-op rather than a crash — ~50 call
 * sites assume they can fire and forget. The jest environment has no
 * EXPO_PUBLIC_POSTHOG_API_KEY, so this exercises exactly the shipped-without-
 * a-key state the workflows now refuse to publish.
 *
 * Everything below it is the opposite state: a stubbed client, so the shape
 * of what reaches PostHog can be asserted. The privacy-relevant test in this
 * file is "reset() clears the context" — without it the next account on a
 * device inherits the previous account's kind and city, and a business
 * signing in after a traveler is counted as a traveler for as long as the
 * process lives.
 */

// The dev warning about the missing key is the point of the no-key state,
// not noise this test should print.
jest.spyOn(console, 'warn').mockImplementation(() => {});

const mockClient = {
  capture: jest.fn(),
  identify: jest.fn(),
  reset: jest.fn(),
  optIn: jest.fn(() => Promise.resolve()),
  optOut: jest.fn(() => Promise.resolve()),
};

jest.mock('posthog-react-native', () => ({
  PostHog: jest.fn(() => mockClient),
}));

// Pinned rather than whatever the host happens to report, so the assertion
// about the release properties is about this module and not about the
// runner. Eight characters is the short form BuildStamp prints.
jest.mock('expo-updates', () => ({
  isEmbeddedLaunch: false,
  updateId: 'abcdef01-2345-6789-abcd-ef0123456789',
}));

/**
 * A fresh copy of the module, with or without a key.
 *
 * It has to be re-required per test: the client, the release properties and
 * the identify guard are all module state, and a test that inherited the
 * previous test's identify guard would pass for the wrong reason.
 */
function loadAnalytics(key: string | null) {
  const previous = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  if (key == null) {
    delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  } else {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = key;
  }
  let loaded!: typeof import('@/lib/analytics');
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@/lib/analytics') as typeof import('@/lib/analytics');
  });
  if (previous == null) {
    delete process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
  } else {
    process.env.EXPO_PUBLIC_POSTHOG_API_KEY = previous;
  }
  return loaded;
}

/** The properties of the nth capture that reached the stubbed client. */
function propertiesOf(call: number): Record<string, unknown> {
  return (mockClient.capture.mock.calls[call]?.[1] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('analytics without a key', () => {
  it('does not throw on any call when the client is null', () => {
    const { analytics } = loadAnalytics(null);
    expect(() => analytics.capture('map_viewed', { guest: true })).not.toThrow();
    expect(() => analytics.identify('user-1')).not.toThrow();
    expect(() => analytics.setContext({ account_type: 'traveler' })).not.toThrow();
    expect(() => analytics.setOptedOut(true)).not.toThrow();
    expect(() => analytics.reset()).not.toThrow();
  });
});

describe('event context', () => {
  it('puts the running release on every event, with no call site asking', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.capture('map_viewed');
    expect(propertiesOf(0)).toMatchObject({ update_id: 'abcdef01', is_embedded: false });
  });

  it('merges context into every subsequent capture', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.setContext({ account_type: 'business', is_guest: false });
    analytics.setContext({ city_id: 12 });
    analytics.capture('map_viewed');
    expect(propertiesOf(0)).toMatchObject({
      account_type: 'business',
      is_guest: false,
      city_id: 12,
    });
  });

  it('lets an event name a property the context also holds', () => {
    // map_viewed states its own city_id and is the more specific truth; a
    // context that overwrote it would silently relabel the event.
    const { analytics } = loadAnalytics('phc_test');
    analytics.setContext({ city_id: 12 });
    analytics.capture('map_viewed', { city_id: 44 });
    expect(propertiesOf(0).city_id).toBe(44);
  });
});

describe('identify', () => {
  it('fires once when the same id arrives twice', () => {
    // The shape a token refresh and a cold start's INITIAL_SESSION make.
    const { analytics } = loadAnalytics('phc_test');
    analytics.identify('opaque-1');
    analytics.identify('opaque-1');
    expect(mockClient.identify).toHaveBeenCalledTimes(1);
  });

  it('fires again when the id actually changes', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.identify('opaque-1');
    analytics.identify('opaque-2');
    expect(mockClient.identify).toHaveBeenCalledTimes(2);
  });

  it('identifies again after a reset, even with the same id', () => {
    // Signing back in on the same device is a real identify, not a repeat.
    const { analytics } = loadAnalytics('phc_test');
    analytics.identify('opaque-1');
    analytics.reset();
    analytics.identify('opaque-1');
    expect(mockClient.identify).toHaveBeenCalledTimes(2);
  });
});

describe('reset', () => {
  it('clears the context so the next account inherits nothing', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.setContext({ account_type: 'business', city_id: 12 });
    analytics.reset();
    analytics.capture('map_viewed');
    const properties = propertiesOf(0);
    expect(properties.account_type).toBeUndefined();
    expect(properties.city_id).toBeUndefined();
  });

  it('keeps the release properties, which belong to the code and not the account', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.reset();
    analytics.capture('map_viewed');
    expect(propertiesOf(0)).toMatchObject({ update_id: 'abcdef01', is_embedded: false });
  });

  it('re-states an opt-out that a PostHog reset would have cleared', () => {
    // Otherwise somebody who turned analytics off and then signed out is
    // silently turned back on by the sign-out.
    const { analytics } = loadAnalytics('phc_test');
    analytics.setOptedOut(true);
    mockClient.optOut.mockClear();
    analytics.reset();
    expect(mockClient.optOut).toHaveBeenCalledTimes(1);
    expect(analytics.optedOut()).toBe(true);
  });

  it('leaves an opted-in device opted in', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.reset();
    expect(mockClient.optOut).not.toHaveBeenCalled();
    expect(analytics.optedOut()).toBe(false);
  });
});

describe('opt-out', () => {
  it('goes through the SDK in both directions', () => {
    const { analytics } = loadAnalytics('phc_test');
    analytics.setOptedOut(true);
    expect(mockClient.optOut).toHaveBeenCalledTimes(1);
    expect(analytics.optedOut()).toBe(true);
    analytics.setOptedOut(false);
    expect(mockClient.optIn).toHaveBeenCalledTimes(1);
    expect(analytics.optedOut()).toBe(false);
  });
});
