import AsyncStorage from '@react-native-async-storage/async-storage';

import { usePushPrimer } from '@/features/notifications/primer-store';
import {
  enablePushNotifications,
  pushPermissionGranted,
  pushPermissionState,
  pushPossible,
} from '@/features/notifications/push';

jest.mock('@/features/notifications/push', () => ({
  enablePushNotifications: jest.fn(),
  pushPermissionGranted: jest.fn(),
  pushPermissionState: jest.fn(),
  pushPossible: jest.fn(),
}));

const granted = pushPermissionGranted as jest.MockedFunction<typeof pushPermissionGranted>;
const state = pushPermissionState as jest.MockedFunction<typeof pushPermissionState>;
const enable = enablePushNotifications as jest.MockedFunction<typeof enablePushNotifications>;
const possible = pushPossible as jest.MockedFunction<typeof pushPossible>;

beforeEach(async () => {
  await AsyncStorage.clear();
  usePushPrimer.setState({ reason: null, asking: null, busy: false });
  granted.mockResolvedValue(false);
  state.mockResolvedValue('undetermined');
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

  // THE RULE THIS FILE USED TO ENCODE was "never asks a second time,
  // whichever way the first went". It was a single key, and the effect was
  // that the one ask was always spent on something the person had just DONE:
  // both moments are outbound. Somebody who reads rather than writes was
  // never asked, so the first hello to reach them landed in silence.
  //
  // The rule now is at most two, keyed per reason. The half of the old rule
  // that was right - the same question is never put twice - is the first
  // case below, and it is the one that stops this becoming nagging.
  it('never asks about the same moment twice, however the first went', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().decline();
    expect(usePushPrimer.getState().reason).toBeNull();

    await usePushPrimer.getState().ask('hello-sent');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('offers a different moment its own ask after the first was declined', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().decline();

    await usePushPrimer.getState().ask('hello-received');
    expect(usePushPrimer.getState().reason).toBe('hello-received');
  });

  it('spends at most two asks, ever, across every moment', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().decline();
    await usePushPrimer.getState().ask('hello-received');
    await usePushPrimer.getState().decline();

    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('does not ask again after somebody says yes', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().accept();
    expect(enable).toHaveBeenCalledTimes(1);
    // What the OS says once permission is granted, which is the real reason
    // the second moment stays quiet.
    granted.mockResolvedValue(true);
    state.mockResolvedValue('granted');

    await usePushPrimer.getState().ask('hello-received');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('says nothing once the OS has been told no', async () => {
    // The clause the single-key version could not express. A re-armed sheet
    // here would offer a Notify me that calls requestPermissionsAsync, is
    // refused in the same frame, and registers nothing - a button that lies.
    enable.mockResolvedValue('denied');
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().accept();
    state.mockResolvedValue('denied');

    await usePushPrimer.getState().ask('hello-received');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('does not stack a second offer over one already on screen', async () => {
    await usePushPrimer.getState().ask('hello-sent');
    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBe('hello-sent');
  });
});

/**
 * THE CALM ASK, and what it costs the two it replaces.
 *
 * Founder, 2026-09-09: ask on first run, primed rather than cold. The whole
 * design turns on one fact about iOS - the system alert is shown once per
 * install and only Settings can undo a no - so the ask that matters is the
 * cheap one, and a "Not now" here must leave the expensive one unspent.
 */
describe('the first-session ask', () => {
  it('offers at the end of signup, before anything has been done to earn it', async () => {
    await usePushPrimer.getState().ask('first-session');
    expect(usePushPrimer.getState().reason).toBe('first-session');
  });

  it('stands the two outbound moments down once it has been made', async () => {
    // Both of them are proxies for "engaged enough to be worth asking", and
    // the first-run primer is a better version of the same guess. Left armed
    // they would spend the account's SECOND ask within minutes of the first:
    // sign up, decline, post a pin, and be asked again.
    await usePushPrimer.getState().ask('first-session');
    await usePushPrimer.getState().decline();

    await usePushPrimer.getState().ask('hello-sent');
    expect(usePushPrimer.getState().reason).toBeNull();
    await usePushPrimer.getState().ask('pin-posted');
    expect(usePushPrimer.getState().reason).toBeNull();
  });

  it('keeps the second ask for the moment that argues from something inbound', async () => {
    // 'hello-received' is the only ask in the app that argues from something
    // that already happened TO the person, and no outbound moment can stand
    // in for it. This is why the cap does not need raising.
    await usePushPrimer.getState().ask('first-session');
    await usePushPrimer.getState().decline();

    await usePushPrimer.getState().ask('hello-received');
    expect(usePushPrimer.getState().reason).toBe('hello-received');
  });

  it("leaves a business's own moment armed too", async () => {
    // A business never reaches either outbound reason, and listing-live is
    // its inbound equivalent.
    await usePushPrimer.getState().ask('first-session');
    await usePushPrimer.getState().decline();

    expect(await usePushPrimer.getState().askBusiness('listing-live')).toBe(true);
  });

  it('still spends one of the two, so three sheets are impossible', async () => {
    await usePushPrimer.getState().ask('first-session');
    await usePushPrimer.getState().decline();
    await usePushPrimer.getState().ask('hello-received');
    await usePushPrimer.getState().decline();

    expect(await usePushPrimer.getState().canAsk('listing-live')).toBe(false);
  });
});
