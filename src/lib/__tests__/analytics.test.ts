/**
 * The no-op path is the dangerous one: without a key, `client` is null and
 * every capture() must stay a silent no-op rather than a crash — ~50 call
 * sites assume they can fire and forget. The jest environment has no
 * EXPO_PUBLIC_POSTHOG_API_KEY, so this exercises exactly the shipped-without-
 * a-key state the workflows now refuse to publish.
 */

// The dev warning about the missing key is the point of the no-key state,
// not noise this test should print.
jest.spyOn(console, 'warn').mockImplementation(() => {});

describe('analytics without a key', () => {
  it('does not throw on any call when the client is null', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { analytics } = require('@/lib/analytics') as typeof import('@/lib/analytics');
      expect(() => analytics.capture('map_viewed', { guest: true })).not.toThrow();
      expect(() => analytics.identify('user-1')).not.toThrow();
      expect(() => analytics.reset()).not.toThrow();
    });
  });
});
