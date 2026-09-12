import { act, renderHook } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';

import { useAuthStore } from '@/features/auth/store';
import { retrySession, useAuthListener } from '@/features/auth/use-auth-listener';
import { queryClient, resetReachForTests } from '@/lib/query-client';

/**
 * "Could not check" is not "nobody is signed in".
 *
 * For a token inside auth-js's expiry margin (the app closed for an hour or
 * more), getSession() awaits a refresh; offline, that refresh fails with a
 * RETRYABLE error and auth-js answers `{ session: null, error }` while keeping
 * the session on disk. The listener used to read the null half only, so a
 * traveler who opened the app on a plane became a visitor until the refresh
 * ticker succeeded after landing. These pin the other reading, and the way
 * out of it that does not depend on a tap.
 */
const mockGetSession = jest.fn();

type AuthChange = (event: string, session: Session | null) => void;
let authChange: AuthChange | null = null;

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: () => mockGetSession(),
      onAuthStateChange: jest.fn((callback: AuthChange) => {
        authChange = callback;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      }),
    },
  },
}));
jest.mock('expo-linking', () => ({
  getInitialURL: jest.fn(async () => null),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('@/features/notifications/push', () => ({ refreshPushToken: jest.fn() }));
jest.mock('@/lib/analytics', () => ({
  analytics: { setContext: jest.fn(), reset: jest.fn(), identify: jest.fn() },
}));
jest.mock('@/lib/device-locale', () => ({ writeDeviceLocale: jest.fn(async () => {}) }));
jest.mock('@/features/guest/hooks', () => ({ useAccountType: () => 'signed_out' }));
jest.mock('@/features/auth/apple-revoke', () => ({ appleCredentialSnapshot: () => null }));
jest.mock('@/features/auth/api', () => ({
  consumeDeliberateSignOut: jest.fn(),
  signOutWasDeliberate: jest.fn(() => false),
}));

const session = { user: { id: 'u1', is_anonymous: false } } as unknown as Session;

/** What auth-js hands back for a refresh that never reached the server. */
const retryable = () => ({
  data: { session: null },
  error: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 },
});

const flush = () => act(async () => {});

let key = 0;
const reachTheServer = () =>
  act(async () => {
    await queryClient.fetchQuery({
      queryKey: ['session-unknown-probe', key++],
      queryFn: () => Promise.resolve(1),
      retry: false,
      gcTime: 0,
    });
  });

describe('a session that could not be checked', () => {
  beforeEach(() => {
    queryClient.clear();
    resetReachForTests();
    useAuthStore.setState({ session: null, initialized: false, sessionUnknown: false });
    mockGetSession.mockReset();
  });

  it('is unknown, not signed out, and the root is still initialized', async () => {
    mockGetSession.mockResolvedValueOnce(retryable());
    renderHook(() => useAuthListener());
    await flush();
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.sessionUnknown).toBe(true);
    expect(state.initialized).toBe(true);
  });

  it('stays unknown when auth-js answers INITIAL_SESSION with null for the same failure', async () => {
    // GoTrueClient._emitInitialSession runs the same loader as getSession and,
    // when it fails retryably, emits INITIAL_SESSION with null while the
    // session stays on disk. Read as an answer, that null cleared the flag
    // and demoted the traveler the lookup had just refused to demote.
    mockGetSession.mockResolvedValueOnce(retryable());
    renderHook(() => useAuthListener());
    await flush();
    expect(useAuthStore.getState().sessionUnknown).toBe(true);
    act(() => authChange?.('INITIAL_SESSION', null));
    expect(useAuthStore.getState().sessionUnknown).toBe(true);
    expect(useAuthStore.getState().session).toBeNull();
    // A real answer through the same event is still taken: the token
    // refreshed after all.
    act(() => authChange?.('INITIAL_SESSION', session));
    expect(useAuthStore.getState().sessionUnknown).toBe(false);
    expect(useAuthStore.getState().session).toBe(session);
  });

  it('takes a null INITIAL_SESSION when nothing is unknown, which is a real sign-out', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session }, error: null });
    renderHook(() => useAuthListener());
    await flush();
    expect(useAuthStore.getState().session).toBe(session);
    act(() => authChange?.('INITIAL_SESSION', null));
    expect(useAuthStore.getState().session).toBeNull();
    expect(useAuthStore.getState().sessionUnknown).toBe(false);
  });

  it('is also unknown when the failure only reads as offline, whatever its name', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: null },
      error: new TypeError('Network request failed'),
    });
    renderHook(() => useAuthListener());
    await flush();
    expect(useAuthStore.getState().sessionUnknown).toBe(true);
  });

  // auth-js removes the session itself for a refresh the server REFUSED and
  // emits SIGNED_OUT; that null is a real answer.
  it('reads a refusal the server sent as signed out', async () => {
    mockGetSession.mockResolvedValueOnce({
      data: { session: null },
      error: { name: 'AuthApiError', message: 'Invalid Refresh Token', status: 400 },
    });
    renderHook(() => useAuthListener());
    await flush();
    const state = useAuthStore.getState();
    expect(state.session).toBeNull();
    expect(state.sessionUnknown).toBe(false);
    expect(state.initialized).toBe(true);
  });

  it('and a plain null with no error is signed out', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    renderHook(() => useAuthListener());
    await flush();
    expect(useAuthStore.getState().sessionUnknown).toBe(false);
  });

  it('is cleared by asking again and getting a session', async () => {
    mockGetSession.mockResolvedValueOnce(retryable());
    renderHook(() => useAuthListener());
    await flush();
    expect(useAuthStore.getState().sessionUnknown).toBe(true);

    mockGetSession.mockResolvedValueOnce({ data: { session }, error: null });
    await act(() => retrySession());
    const state = useAuthStore.getState();
    expect(state.session).toBe(session);
    expect(state.sessionUnknown).toBe(false);
  });

  // The way out that needs no tap. The offline card leaves the moment
  // anything reaches the server, so a session still unknown at that point
  // would be a mute, permanent hold.
  it('asks again on its own the moment the server is reached', async () => {
    mockGetSession.mockResolvedValueOnce(retryable());
    renderHook(() => useAuthListener());
    await flush();
    expect(mockGetSession).toHaveBeenCalledTimes(1);

    mockGetSession.mockResolvedValueOnce({ data: { session }, error: null });
    await reachTheServer();
    await flush();
    expect(mockGetSession).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().session).toBe(session);
    expect(useAuthStore.getState().sessionUnknown).toBe(false);
  });

  it('does not ask again on reach when the session is already known', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session }, error: null });
    renderHook(() => useAuthListener());
    await flush();
    await reachTheServer();
    await flush();
    expect(mockGetSession).toHaveBeenCalledTimes(1);
  });

  // auth-js caches a failed refresh for 60s and answers from the cache, so
  // the first try after reconnect usually gets the same error; the cadence
  // catches the cache expiring. And a reachable server whose auth keeps
  // failing is not a reason to hold the app shut forever: after the limit
  // the answer is read as signed out, and a later TOKEN_REFRESHED from
  // auth-js's own ticker still arrives through onAuthStateChange.
  it('keeps asking on a cadence while reachable, then gives up as signed out', async () => {
    jest.useFakeTimers();
    try {
      mockGetSession.mockResolvedValue(retryable());
      renderHook(() => useAuthListener());
      await flush();
      await reachTheServer();
      await flush();
      expect(mockGetSession).toHaveBeenCalledTimes(2);

      for (let tick = 0; tick < 8; tick += 1) {
        await act(async () => {
          jest.advanceTimersByTime(10_000);
        });
        await flush();
      }
      expect(mockGetSession).toHaveBeenCalledTimes(10);
      expect(useAuthStore.getState().sessionUnknown).toBe(true);

      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
      await flush();
      const state = useAuthStore.getState();
      expect(mockGetSession).toHaveBeenCalledTimes(10);
      expect(state.sessionUnknown).toBe(false);
      expect(state.session).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
