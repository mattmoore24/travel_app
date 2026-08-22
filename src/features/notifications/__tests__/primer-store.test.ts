import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePushPrimer } from '@/features/notifications/primer-store';
import {
  enablePushNotifications,
  pushPermissionGranted,
  pushPossible,
} from '@/features/notifications/push';

jest.mock('@/features/notifications/push', () => ({
  enablePushNotifications: jest.fn(),
  pushPermissionGranted: jest.fn(),
  pushPossible: jest.fn(),
}));

const granted = pushPermissionGranted as jest.MockedFunction<typeof pushPermissionGranted>;
const enable = enablePushNotifications as jest.MockedFunction<typeof enablePushNotifications>;
const possible = pushPossible as jest.MockedFunction<typeof pushPossible>;

beforeEach(async () => {
  await AsyncStorage.clear();
  usePushPrimer.setState({ reason: null, busy: false });
  granted.mockResolvedValue(false);
  enable.mockResolvedValue('registered');
  possible.mockReturnValue(true);
});

describe('the push primer', () => {
  it('offers once, at the moment there is an answer worth waiting for', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    expect(usePushPrimer.getState().reason).toBe('hello-sent');
  });

  it('says nothing at all where a notification could never arrive', async () => {
    // A simulator, Expo Go, or a build with no EAS project id. Asking there
    // is a question whose only honest answer is nothing: "Notify me"
    // registers no token and the person is none the wiser.
    possible.mockReturnValue(false);
    await usePushPrimer.getState().ask('hello-sent');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('does not even read the permission where push is impossible', async () => {
    possible.mockReturnValue(false);
    await usePushPrimer.getState().ask('pin-posted');
    expect(granted).not.toHaveBeenCalled();
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
