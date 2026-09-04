import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { intentTimeLabel } from '@/features/pins/pin-helpers';

/**
 * The hour, end to end through the form.
 *
 * A column nothing writes is a column nobody has: this is the test that says
 * the control is MOUNTED, that it starts with NOTHING chosen (the founder:
 * "an optional field, not a preselected bubble"), and that what somebody
 * picks - an hour, a window, or TBD - reaches the mutation. The database's
 * own guards are pgTAP's half (56_a_pin_carries_an_hour, 76_a_pin_goes_where
 * _the_traveler_goes).
 */

// Typed with its argument, because the argument IS the assertion here.
const mockMutateAsync = jest.fn(async (_input: Record<string, unknown>) => ({ id: 'pin-1' }));

jest.mock('@/features/pins/hooks', () => ({
  useCreatePin: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));
// The Sheet is chrome this test does not exercise; render straight through.
jest.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: unknown }) => children,
}));
// PinGlyph's module reaches react-native-maps, whose native module does not
// exist under jest.
jest.mock('react-native-maps', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const RN = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Marker: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(RN.View, null, children),
    Polygon: () => null,
    Circle: () => null,
    PROVIDER_DEFAULT: 'default',
  };
});
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(async () => []),
}));

// Ten in the morning in the runner's own zone, and a city on the same clock,
// so the hours the rail offers are the ones this test names.
const MORNING = new Date(2026, 8, 1, 10, 0);

function renderForm() {
  return render(
    <PinFormSheet
      cityId={1}
      cityName="Lisbon"
      cityTimezone={null}
      coords={{ lat: 38.7067, lng: -9.1459 }}
      initialPlace={null}
      initialLabel="Time Out Market"
      onClose={jest.fn()}
      onPosted={jest.fn()}
    />
  );
}

describe('the optional hour on the pin form', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(MORNING);
    mockMutateAsync.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers a time rail with nothing lit, and a TBD chip rather than an "Any time" one', () => {
    renderForm();
    expect(screen.getByText('Time (optional)')).toBeTruthy();
    expect(screen.getByText('TBD')).toBeTruthy();
    expect(screen.queryByText('Any time')).toBeNull();
    expect(screen.getByTestId('time-tbd').props.accessibilityState.selected).toBe(false);
    expect(screen.getByTestId('time-19:00').props.accessibilityState.selected).toBe(false);
    // No end rail until there is a start for it to follow.
    expect(screen.queryByText('Until (optional)')).toBeNull();
  });

  // OPTIONAL MEANS OPTIONAL. A pre-filled hour would make every "sometime
  // that evening" plan a small lie the poster has to notice and undo.
  it('posts no hour at all when nobody picks one', async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: null,
      intentTimeEnd: null,
      timeTbd: false,
    });
  });

  it('carries the hour somebody picked into the pin', async () => {
    renderForm();
    fireEvent.press(screen.getByTestId('time-19:00'));
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: '19:00',
      intentTimeEnd: null,
      timeTbd: false,
    });
  });

  it('a window: the end rail follows the start, and both reach the pin', async () => {
    renderForm();
    fireEvent.press(screen.getByTestId('time-19:00'));
    expect(screen.getByText('Until (optional)')).toBeTruthy();
    // Hours after the start only, and the pin's own expiry is the ceiling.
    expect(screen.queryByTestId('until-19:00')).toBeNull();
    fireEvent.press(screen.getByTestId('until-22:00'));
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: '19:00',
      intentTimeEnd: '22:00',
      timeTbd: false,
    });
  });

  it('TBD is an answer of its own, and it reaches the pin as one', async () => {
    renderForm();
    fireEvent.press(screen.getByTestId('time-tbd'));
    expect(screen.getByTestId('time-tbd').props.accessibilityState.selected).toBe(true);
    expect(screen.queryByText('Until (optional)')).toBeNull();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: null,
      intentTimeEnd: null,
      timeTbd: true,
    });
    expect(screen.getByText(/Today, time TBD/)).toBeTruthy();
  });

  it('tapping the lit chip again puts it out, end and all', async () => {
    renderForm();
    fireEvent.press(screen.getByTestId('time-19:00'));
    fireEvent.press(screen.getByTestId('until-22:00'));
    fireEvent.press(screen.getByTestId('time-19:00'));
    expect(screen.getByTestId('time-19:00').props.accessibilityState.selected).toBe(false);
    expect(screen.queryByText('Until (optional)')).toBeNull();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: null,
      intentTimeEnd: null,
      timeTbd: false,
    });
  });

  // The readout above the button is the only place the choice is echoed once
  // the rail has scrolled, and it must never read as a presence claim.
  it('echoes the choice as a plan rather than a position', () => {
    renderForm();
    fireEvent.press(screen.getByTestId('time-19:00'));
    const readout = `Today at ${intentTimeLabel('19:00')}`;
    expect(screen.getByText(new RegExp(readout))).toBeTruthy();
    fireEvent.press(screen.getByTestId('until-22:00'));
    expect(
      screen.getByText(
        new RegExp(`Today, ${intentTimeLabel('19:00')} to ${intentTimeLabel('22:00')}`)
      )
    ).toBeTruthy();
  });
});
