import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePushPrimer } from '@/features/notifications/primer-store';
import { enablePushNotifications, pushPermissionGranted } from '@/features/notifications/push';

jest.mock('@/features/notifications/push', () => ({
  enablePushNotifications: jest.fn(),
  pushPermissionGranted: jest.fn(),
}));

const granted = pushPermissionGranted as jest.MockedFunction<typeof pushPermissionGranted>;
const enable = enablePushNotifications as jest.MockedFunction<typeof enablePushNotifications>;

beforeEach(async () => {
  await AsyncStorage.clear();
  usePushPrimer.setState({ reason: null, busy: false });
  granted.mockResolvedValue(false);
  enable.mockResolvedValue('registered');
});

describe('the push primer', () => {
  it('offers once, at the moment there is an answer worth waiting for', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    expect(usePushPrimer.getState().reason).toBe('hello-sent');
  });

  it('says nothing when notifications are already on', async () => {
    granted.mockResolvedValue(true);
    await usePushPrimer.getState().ask('hello-sent');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('never asks a second time, whichever way the first went', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().decline();
    expect(usePushPrimer.getState().reason).toBeNull();

    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('does not ask again after somebody says yes', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().accept();
    expect(enable).toHaveBeenCalledTimes(1);

    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('remembers the offer even when the OS dialog is declined', async () => {
    enable.mockResolvedValue('denied');
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().accept();

    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('does not stack a second offer over one already on screen', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBe('hello-sent');
  });
});
