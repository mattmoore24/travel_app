import * as Notifications from 'expo-notifications';
import { renderHook } from '@testing-library/react-native';

import { clearIconBadge, useIconBadge } from '@/features/notifications/badge';
import { pushPossible } from '@/features/notifications/push';

/**
 * The icon badge, and the one device where it must stay quiet.
 *
 * pushPossible() is false on a simulator, in Expo Go, and in any build with
 * no EAS project id. There is no icon badge to write there, and the primer
 * already promises that a device which cannot receive a notification is never
 * bothered about one. Same promise, one layer down.
 */

jest.mock('expo-notifications', () => ({ setBadgeCountAsync: jest.fn() }));
jest.mock('@/features/notifications/push', () => ({ pushPossible: jest.fn() }));

const possible = pushPossible as jest.MockedFunction<typeof pushPossible>;
const setBadge = Notifications.setBadgeCountAsync as jest.Mock;

beforeEach(() => {
  setBadge.mockResolvedValue(true);
});

describe('the home-screen icon badge', () => {
  it('writes the count where a notification could arrive', () => {
    possible.mockReturnValue(true);
    renderHook(({ count }: { count: number }) => useIconBadge(count), {
      initialProps: { count: 3 },
    });
    expect(setBadge).toHaveBeenCalledWith(3);
  });

  it('writes nothing at all where push is impossible', () => {
    possible.mockReturnValue(false);
    renderHook(() => useIconBadge(3));
    expect(setBadge).not.toHaveBeenCalled();
  });

  it('writes again only when the number changes', () => {
    possible.mockReturnValue(true);
    const hook = renderHook(({ count }: { count: number }) => useIconBadge(count), {
      initialProps: { count: 2 },
    });
    hook.rerender({ count: 2 });
    expect(setBadge).toHaveBeenCalledTimes(1);
    hook.rerender({ count: 0 });
    expect(setBadge).toHaveBeenCalledTimes(2);
    expect(setBadge).toHaveBeenLastCalledWith(0);
  });

  it('wipes the icon on the way out, so a shared phone starts clean', async () => {
    possible.mockReturnValue(true);
    await clearIconBadge();
    expect(setBadge).toHaveBeenCalledWith(0);
  });

  it('swallows a refusal rather than failing a sign-out', async () => {
    possible.mockReturnValue(true);
    setBadge.mockRejectedValue(new Error('no'));
    await expect(clearIconBadge()).resolves.toBeUndefined();
  });
});
