import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

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

const mockState = pushPermissionState as jest.Mock;
const mockPossible = pushPossible as jest.Mock;
const mockEnable = enablePushNotifications as jest.Mock;

let openSettings: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(
      await screen.findByText('On. First messages, replies, and anything about your account.')
    ).toBeTruthy();
  });

  it('offers the OS dialog, never Settings, when iOS was never asked', async () => {
    mockState.mockResolvedValue('undetermined');
    render(<NotificationsRow />);
    expect(
      await screen.findByText('Off. Turn them on and hear when someone answers.')
    ).toBeTruthy();

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
