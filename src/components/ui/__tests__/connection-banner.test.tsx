import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ConnectionBanner } from '@/components/ui/connection-banner';
import { NO_CONNECTION } from '@/lib/failure-message';
import { queryClient } from '@/lib/query-client';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

/**
 * The banner is driven by the app's own traffic (see the connection store in
 * src/lib/query-client.ts), so these drive it the way the app does: by
 * finishing a query. Asserting through the real cache rather than by poking
 * an exported setter is the point — the thing that can break is the wiring
 * between "a request failed" and "a bar appeared", and a setter test would
 * pass with that wiring cut.
 */
let key = 0;
const finish = async (result: 'ok' | unknown) =>
  act(async () => {
    await queryClient
      .fetchQuery({
        queryKey: ['connection-banner-probe', key++],
        queryFn: () => (result === 'ok' ? Promise.resolve(1) : Promise.reject(result)),
        retry: false,
        gcTime: 0,
      })
      .catch(() => {});
  });

const dropTheWifi = () => finish(new Error('Network request failed'));
const reachTheServer = () => finish('ok');

describe('the connection banner', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    queryClient.clear();
    // Whatever the previous test left behind, start each one connected.
    await reachTheServer();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing while the app can reach the server', () => {
    render(<ConnectionBanner />);
    expect(screen.toJSON()).toBeNull();
  });

  it('says so when a request never leaves the phone', async () => {
    render(<ConnectionBanner />);
    await dropTheWifi();
    expect(screen.getByText('No connection')).toBeTruthy();
  });

  // One sentence in the product: the bar under the notch and the sentence a
  // failed screen prints are the same words, because they are usually on
  // screen together.
  it('says it in the words lib/failure-message owns', async () => {
    render(<ConnectionBanner />);
    await dropTheWifi();
    expect(screen.getByText(NO_CONNECTION)).toBeTruthy();
  });

  // The traps skill's ModalHostView entry, applied: an absolutely-positioned
  // overlay that swallows touches looks like a dead app, and there is no
  // render that distinguishes it from a working one.
  it('lets every touch through to the screen underneath', async () => {
    render(<ConnectionBanner />);
    await dropTheWifi();
    expect(screen.root.props.pointerEvents).toBe('none');
  });

  it('marks the recovery, then takes itself away', async () => {
    render(<ConnectionBanner />);
    await dropTheWifi();
    await reachTheServer();
    expect(screen.getByText('Back online')).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1_500);
    });
    expect(screen.toJSON()).toBeNull();
  });

  it('does not congratulate a connection that was never lost', async () => {
    render(<ConnectionBanner />);
    await reachTheServer();
    expect(screen.queryByText('Back online')).toBeNull();
    expect(screen.toJSON()).toBeNull();
  });

  // A raised exception, a 403, a row that failed a policy: all of them came
  // BACK from the server, so the connection is fine and the screen's own
  // error message is the right place for them.
  it('stays away for a failure the server sent', async () => {
    render(<ConnectionBanner />);
    await finish({ status: 403, message: 'row-level security' });
    expect(screen.toJSON()).toBeNull();
  });

  // And the other direction: something we cannot classify is not evidence
  // that the wifi came back, so it must not clear a banner that is up.
  it('stays up for a failure it cannot classify', async () => {
    render(<ConnectionBanner />);
    await dropTheWifi();
    await finish(new Error('boom'));
    expect(screen.getByText('No connection')).toBeTruthy();
  });
});
