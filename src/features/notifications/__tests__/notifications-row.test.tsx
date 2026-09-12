import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { Skeleton } from '@/components/ui/skeleton';
import { NotificationsRow } from '@/features/notifications/notifications-row';
import {
  enablePushNotifications,
  pushPermissionState,
  pushPossible,
} from '@/features/notifications/push';

// The row's whole job is to read the OS truthfully and offer the one action
// that actually works in each state. The trap it must never fall into:
// somebody who declined the PRIMER was never asked by iOS at all, so Settings
// holds no Samewhere entry - sending them there is sending them to a page
// that does not exist. The OS dialog is the only door that opens from
// 'undetermined', and Settings the only one from 'denied'.

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    // Close enough for a screen that is focused for the whole test: run the
    // effect on mount, the way navigation would on first focus.
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});

jest.mock('@/features/notifications/push', () => ({
  pushPossible: jest.fn(() => true),
  pushPermissionState: jest.fn(async () => 'granted'),
  enablePushNotifications: jest.fn(async () => 'registered'),
}));

// The one switch this app owns. Mocked here because the row's subject is the
// OS state; what the switch DOES is a query and a write, tested where those
// live.
const mockSetClocks = jest.fn();
const mockRetry = jest.fn();
const mockClocks = { on: true, known: true, error: null as unknown };
jest.mock('@/features/notifications/use-notification-prefs', () => ({
  useTripClocks: () => ({
    on: mockClocks.on,
    known: mockClocks.known,
    error: mockClocks.error,
    retry: mockRetry,
    set: mockSetClocks,
    saving: false,
  }),
}));

const mockState = pushPermissionState as jest.Mock;
const mockPossible = pushPossible as jest.Mock;
const mockEnable = enablePushNotifications as jest.Mock;

let openSettings: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockClocks.on = true;
  mockClocks.known = true;
  mockClocks.error = null;
  mockPossible.mockReturnValue(true);
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => {
  openSettings.mockRestore();
});

describe('the Notifications row', () => {
  it('says what is on, exactly, when the OS says granted', async () => {
    mockState.mockResolvedValue('granted');
    render(<NotificationsRow />);
    // FOUR kinds, not three. The three within-trip clocks ship as a fourth,
    // and the sentence anybody reads here has to be the same promise the
    // primer made before they said yes.
    expect(
      await screen.findByText(
        'On. First messages, replies, your own trips and plans, and anything about your account.'
      )
    ).toBeTruthy();
  });

  it('offers the trip reminders switch only once the OS has said yes', async () => {
    mockState.mockResolvedValue('granted');
    render(<NotificationsRow />);
    const control = await screen.findByLabelText(/Turn (on|off) trip reminders/);
    expect(control).toBeTruthy();

    fireEvent.press(control);
    expect(mockSetClocks).toHaveBeenCalledWith(false);
  });

  it('says what stays on when the trip reminders are off', async () => {
    mockClocks.on = false;
    mockState.mockResolvedValue('granted');
    render(<NotificationsRow />);
    // The half that matters: switching off a digest must not read as
    // switching off the conversation, and it does not switch one off either
    // (pgTAP 49).
    expect(
      await screen.findByText('Trip reminders are off. Replies and account notices still arrive.')
    ).toBeTruthy();
  });

  it('draws a shape, never "on", while the preference is still on its way', async () => {
    // `on` defaults to true while the query is pending, so without the gate
    // the row said "Trip reminders are on" with a Turn off button and then
    // flipped to off for anybody who had turned them off.
    mockClocks.known = false;
    mockClocks.on = true;
    mockState.mockResolvedValue('granted');
    render(<NotificationsRow />);
    await screen.findByText(/^On\. First messages/);
    expect(screen.queryByText(/Trip reminders are/)).toBeNull();
    expect(screen.queryByLabelText(/Turn (on|off) trip reminders/)).toBeNull();
    expect(screen.UNSAFE_getAllByType(Skeleton)).toHaveLength(1);
  });

  it('says the preference could not be read, and offers a retry', async () => {
    mockClocks.known = false;
    mockClocks.error = new Error('offline');
    mockState.mockResolvedValue('granted');
    render(<NotificationsRow />);
    fireEvent.press(await screen.findByText('Try again'));
    expect(mockRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Trip reminders are/)).toBeNull();
    expect(screen.UNSAFE_queryAllByType(Skeleton)).toHaveLength(0);
  });

  it('does not offer a preference about pushes on a phone that refuses them', async () => {
    mockState.mockResolvedValue('denied');
    render(<NotificationsRow />);
    await screen.findByText('Off. Turn them on in Settings');
    expect(screen.queryByLabelText(/Turn (on|off) trip reminders/)).toBeNull();
  });

  it('offers the OS dialog, never Settings, when iOS was never asked', async () => {
    mockState.mockResolvedValue('undetermined');
    render(<NotificationsRow />);
    expect(await screen.findByText('Off.')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Turn on notifications'));
    await waitFor(() => expect(mockEnable).toHaveBeenCalledTimes(1));
    expect(openSettings).not.toHaveBeenCalled();
  });

  it('offers Settings, never the dead OS dialog, after a real denial', async () => {
    mockState.mockResolvedValue('denied');
    render(<NotificationsRow />);
    expect(await screen.findByText('Off. Turn them on in Settings')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open Settings'));
    await waitFor(() => expect(openSettings).toHaveBeenCalledTimes(1));
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it('renders nothing at all where push can never work', async () => {
    mockPossible.mockReturnValue(false);
    mockState.mockResolvedValue('granted');
    const view = render(<NotificationsRow />);
    // Nothing to wait for: the guard means the read never even runs.
    expect(mockState).not.toHaveBeenCalled();
    expect(view.toJSON()).toBeNull();
  });
});
