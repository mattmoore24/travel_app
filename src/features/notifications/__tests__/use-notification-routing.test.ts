import { act, renderHook } from '@testing-library/react-native';

import {
  resetColdStartForTests,
  routeForPayload,
  useNotificationRouting,
} from '@/features/notifications/use-notification-routing';

/**
 * A tapped notification opens the thing it is about — every payload type the
 * database writes lands on its screen, a payload from an old build breaks
 * nothing, and the cold-start tap is spent exactly once.
 */

const mockGetLast = jest.fn<Promise<unknown>, []>();
const mockAddListener = jest.fn();
const mockRemove = jest.fn();

jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: () => mockGetLast(),
  addNotificationResponseReceivedListener: (listener: unknown) => {
    mockAddListener(listener);
    return { remove: mockRemove };
  },
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (route: string) => mockPush(route) },
}));

const mockCapture = jest.fn();
jest.mock('@/lib/analytics', () => ({
  analytics: { capture: (...args: unknown[]) => mockCapture(...args) },
}));

jest.mock('@/features/notifications/push', () => ({
  pushPermissionState: jest.fn().mockResolvedValue('granted'),
}));

const response = (data: Record<string, unknown>, date = Date.now()) => ({
  actionIdentifier: 'default',
  notification: { date, request: { content: { data } } },
});

const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  resetColdStartForTests();
  mockGetLast.mockResolvedValue(null);
});

describe('routeForPayload', () => {
  it.each([
    [{ type: 'message', chat_id: 'c1', kind: 'room' }, '/room/c1'],
    [{ type: 'message', chat_id: 'c1', kind: 'direct' }, '/chat/c1'],
    // An old build's payload carries no kind: a one-to-one is the safe read.
    [{ type: 'message', chat_id: 'c1' }, '/chat/c1'],
    [{ type: 'accepted', chat_id: 'c2' }, '/chat/c2'],
    [{ type: 'request' }, '/(tabs)/chat'],
    [{ type: 'moderation' }, '/guidelines'],
    [{ type: 'verification' }, '/verification'],
    [{ type: 'support' }, '/contact'],
    // The oldest builds sent no payload at all.
    [{}, null],
    [{ type: 'something-newer-than-this-build' }, null],
  ] as const)('%j opens %s', (data, route) => {
    expect(routeForPayload(data as Record<string, unknown>)).toBe(route);
  });
});

describe('a warm tap', () => {
  it('pushes the exact route for the payload', async () => {
    renderHook(() => useNotificationRouting());
    await flush();

    const listener = mockAddListener.mock.calls[0][0] as (r: unknown) => void;
    act(() => listener(response({ type: 'message', chat_id: 'abc', kind: 'room' })));
    expect(mockPush).toHaveBeenCalledWith('/room/abc');

    act(() => listener(response({ type: 'message', chat_id: 'abc', kind: 'direct' })));
    expect(mockPush).toHaveBeenLastCalledWith('/chat/abc');
  });

  it('counts the open, with the age the notification had', async () => {
    renderHook(() => useNotificationRouting());
    await flush();

    const listener = mockAddListener.mock.calls[0][0] as (r: unknown) => void;
    act(() => listener(response({ type: 'accepted', chat_id: 'c9' }, Date.now() - 90_000)));

    expect(mockCapture).toHaveBeenCalledWith(
      'push_opened',
      expect.objectContaining({ type: 'accepted', age_seconds: expect.any(Number) })
    );
    const call = mockCapture.mock.calls.find((c) => c[0] === 'push_opened');
    expect(call?.[1].age_seconds).toBeGreaterThanOrEqual(89);
    expect(call?.[1].age_seconds).toBeLessThanOrEqual(92);
  });

  it('survives a payload from an old build: counted, no navigation', async () => {
    renderHook(() => useNotificationRouting());
    await flush();

    const listener = mockAddListener.mock.calls[0][0] as (r: unknown) => void;
    act(() => listener(response({})));
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith(
      'push_opened',
      expect.objectContaining({ type: null })
    );
  });

  it('removes its listener on unmount', async () => {
    const { unmount } = renderHook(() => useNotificationRouting());
    await flush();
    unmount();
    expect(mockRemove).toHaveBeenCalled();
  });
});

describe('the cold-start tap', () => {
  it('is read once and spent on its route', async () => {
    mockGetLast.mockResolvedValue(response({ type: 'message', chat_id: 'cold', kind: 'room' }));
    const { rerender } = renderHook(() => useNotificationRouting());
    await flush();

    expect(mockPush).toHaveBeenCalledWith('/room/cold');
    expect(mockGetLast).toHaveBeenCalledTimes(1);

    rerender(undefined);
    await flush();
    expect(mockGetLast).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('is not re-read by a remount either', async () => {
    mockGetLast.mockResolvedValue(response({ type: 'accepted', chat_id: 'c1' }));
    const first = renderHook(() => useNotificationRouting());
    await flush();
    first.unmount();

    renderHook(() => useNotificationRouting());
    await flush();
    expect(mockGetLast).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('reports the permission state the phone actually holds', async () => {
    renderHook(() => useNotificationRouting());
    await flush();
    expect(mockCapture).toHaveBeenCalledWith('push_permission_state', { state: 'granted' });
  });
});
