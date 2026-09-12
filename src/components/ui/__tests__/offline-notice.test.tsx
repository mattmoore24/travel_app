import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';

import { ConnectionBanner } from '@/components/ui/connection-banner';
import { OFFLINE_NOTICE_COPY, OfflineNotice } from '@/components/ui/offline-notice';
import { useAuthStore } from '@/features/auth/store';
import { retrySession } from '@/features/auth/use-auth-listener';
import { NO_CONNECTION } from '@/lib/failure-message';
import { queryClient, resetReachForTests } from '@/lib/query-client';
import { probeServer } from '@/lib/supabase';

jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  };
});

// The card calls this beside its refetch when the session is what could not
// be checked; the listener module it lives in pulls in linking, push and
// analytics, none of which is under test here.
jest.mock('@/features/auth/use-auth-listener', () => ({
  retrySession: jest.fn(async () => {}),
}));

// The boot probe, controlled per test. Its default answer is a failure the
// connection store cannot classify: it settles (so the button is a button,
// not a spinner) without deciding anything, and each test then drives the
// verdict it wants through the cache, the way the banner tests do.
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  probeServer: jest.fn(() => Promise.reject(new Error('unclassified'))),
}));

/**
 * Driven the way the app drives it: by finishing a query through the real
 * cache. The wiring that can break is "a request failed before anything
 * succeeded, so a card with Try again appeared, and Try again refetched",
 * and a test that poked an exported setter would pass with it cut.
 */
let key = 0;
const finish = async (result: 'ok' | unknown) =>
  act(async () => {
    await queryClient
      .fetchQuery({
        queryKey: ['offline-notice-probe', key++],
        queryFn: () => (result === 'ok' ? Promise.resolve(1) : Promise.reject(result)),
        retry: false,
        gcTime: 0,
      })
      .catch(() => {});
  });

const dropTheWifi = () => finish(new Error('Network request failed'));
const reachTheServer = () => finish('ok');

/** React Query batches observer updates on a zero timer; one tick lands them. */
const settle = () =>
  act(async () => {
    jest.advanceTimersByTime(1);
  });

const mount = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <OfflineNotice />
    </QueryClientProvider>
  );

describe('the offline notice', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    queryClient.clear();
    useAuthStore.setState({ session: null, sessionUnknown: false });
    // Start each test connected and warm, then forget the warmth: a cold
    // start with the optimistic 'online' guess the store launches with.
    await reachTheServer();
    resetReachForTests();
    jest.mocked(retrySession).mockClear();
    jest.mocked(probeServer).mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders nothing while nothing has been decided', async () => {
    mount();
    await settle();
    expect(screen.toJSON()).toBeNull();
  });

  it('shows the card with a Try again once a request never leaves the phone', async () => {
    mount();
    await dropTheWifi();
    expect(screen.getByText(NO_CONNECTION)).toBeTruthy();
    expect(screen.getByText(/needs the internet to open/)).toBeTruthy();
    await settle();
    expect(screen.getByRole('button', { name: 'Try again to connect' })).toBeTruthy();
  });

  it('refetches what the person is waiting on when they try again', async () => {
    const refetch = jest.spyOn(queryClient, 'refetchQueries').mockResolvedValue();
    mount();
    await dropTheWifi();
    await settle();
    fireEvent.press(screen.getByRole('button', { name: 'Try again to connect' }));
    expect(refetch).toHaveBeenCalledWith({ type: 'active' });
    // A known session needs no second look.
    expect(retrySession).not.toHaveBeenCalled();
    refetch.mockRestore();
  });

  it('asks for the session again too, when the session is what could not be checked', async () => {
    const refetch = jest.spyOn(queryClient, 'refetchQueries').mockResolvedValue();
    useAuthStore.setState({ sessionUnknown: true });
    mount();
    await dropTheWifi();
    await settle();
    fireEvent.press(screen.getByRole('button', { name: 'Try again to connect' }));
    expect(retrySession).toHaveBeenCalledTimes(1);
    refetch.mockRestore();
  });

  // The whole reason the flag is sticky: the card is for the cold start, and
  // the pill is the voice for everything after it.
  it('leaves on the first success and never comes back', async () => {
    mount();
    await dropTheWifi();
    expect(screen.getByText(NO_CONNECTION)).toBeTruthy();
    await reachTheServer();
    expect(screen.toJSON()).toBeNull();
    await dropTheWifi();
    expect(screen.toJSON()).toBeNull();
  });

  // The link that hangs (a hotel wifi with no upstream): nothing fails and
  // nothing succeeds, so the card has only its clock to go on.
  it('says it is still trying after eight silent seconds', async () => {
    mount();
    await settle();
    expect(screen.toJSON()).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(screen.getByText(NO_CONNECTION)).toBeTruthy();
    expect(screen.getByText(/Still trying to connect/)).toBeTruthy();
  });

  it('is driven by its own boot probe, before any other query exists', async () => {
    jest
      .mocked(probeServer)
      .mockRejectedValueOnce(
        Object.assign(new Error('TypeError: Network request failed'), { status: 0 })
      );
    mount();
    await settle();
    expect(probeServer).toHaveBeenCalledTimes(1);
    expect(screen.getByText(NO_CONNECTION)).toBeTruthy();
  });

  it('never shows once its probe has reached the server', async () => {
    jest.mocked(probeServer).mockResolvedValueOnce(401);
    mount();
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(8_000);
    });
    expect(screen.toJSON()).toBeNull();
  });

  // The traps skill's invisible-overlay entry: the container lets touches
  // through to the screen underneath, and only the card itself takes them.
  it('lets touches outside the card through to the screen underneath', async () => {
    mount();
    await dropTheWifi();
    expect(screen.root.props.pointerEvents).toBe('box-none');
  });

  it('is the only voice while it is up: the pill stays away', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <OfflineNotice />
        <ConnectionBanner />
      </QueryClientProvider>
    );
    await dropTheWifi();
    expect(screen.getAllByText(NO_CONNECTION)).toHaveLength(1);
  });
});

describe('what the card says', () => {
  // The same rules src/app/__tests__/copy-lint.test.ts holds the database's
  // copy to, plus the design brief's presence claims.
  const BANNED = /\b(swipe|deck|match|unmatch(?:ed)?|request|here now|nearby|near you)\b/i;

  it('has no em dash and no banned word', () => {
    for (const sentence of OFFLINE_NOTICE_COPY) {
      expect(sentence).not.toContain('—');
      expect(sentence).not.toMatch(BANNED);
    }
  });

  it('uses the words lib/failure-message owns for the fault', () => {
    expect(OFFLINE_NOTICE_COPY).toContain(NO_CONNECTION);
  });

  it('calls the button by the name the rest of the app uses', () => {
    // "Retry" is a developer's word; the account error and every LoadError
    // say Try again, and one act gets one name.
    expect(OFFLINE_NOTICE_COPY).toContain('Try again');
    expect(OFFLINE_NOTICE_COPY).not.toContain('Retry');
  });

  it("speaks the button with its object, so it is not the map's own Try again", async () => {
    // A guest's offline start draws the map's LoadError under this card,
    // and that button is spoken "Try again" too. Same printed word, a
    // spoken label that starts with it and says what it tries.
    mount();
    await dropTheWifi();
    await settle();
    const button = screen.getByRole('button', { name: 'Try again to connect' });
    expect(button.props.accessibilityLabel).toMatch(/^Try again/);
  });
});

/**
 * THE MOUNT, which no render test can see. The connection banner shipped
 * with every test green and no entry point, and this is the same shape of
 * component in the same place, so it is pinned the same way.
 */
describe('the card is actually in the app', () => {
  const layout = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'app', '_layout.tsx'),
    'utf8'
  );
  const card = fs.readFileSync(path.join(__dirname, '..', 'offline-notice.tsx'), 'utf8');

  it('is mounted in the root layout as a sibling of the navigator', () => {
    const nav = layout.indexOf('<RootNavigator />');
    const notice = layout.indexOf('<OfflineNotice />');
    const themeClose = layout.indexOf('</ThemeProvider>');
    expect(nav).toBeGreaterThan(-1);
    expect(notice).toBeGreaterThan(nav);
    expect(notice).toBeLessThan(themeClose);
  });

  it("is a card, never a Modal, and never returned in the navigator's place", () => {
    // A Modal presented on a data event is the presentation iOS drops
    // (traps), and a component returned instead of the Stack is the
    // root-hold trap the layout's own comments record.
    expect(card).not.toMatch(/<Modal\b/);
    expect(layout).not.toMatch(/return <OfflineNotice/);
  });

  it('sits at the same offset as the pill, clear of the top control row', () => {
    expect(card).toContain('insets.top + Spacing.two + HitTarget + Space.xs');
  });

  it('has no fixed height and caps no line, so it grows at the accessibility sizes', () => {
    expect(card).not.toMatch(/\bheight:/);
    expect(card).not.toMatch(/maxHeight/);
    expect(card).not.toMatch(/numberOfLines/);
  });
});
