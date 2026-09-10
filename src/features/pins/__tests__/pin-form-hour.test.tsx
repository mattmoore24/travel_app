import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { intentTimeLabel } from '@/features/pins/pin-helpers';
import { formatDate, parseISODate } from '@/features/trips/dates';
import { dates } from '@/lib/locale';

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
// The settle delay is zero so a calendar opened straight after another one
// closed does not wait on a timer the test never advances.
jest.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: unknown }) => children,
  SHEET_SETTLE_MS: 0,
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
    // Hours after the start only.
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

/**
 * The day a pin comes down, through the form. Founder, 2026-09-10: the
 * traveler picks the date, a year at most, and a date BEFORE the plan is
 * legal — with "just small text ... to remind them of their choice".
 */
describe('the day a pin comes down, through the form', () => {
  const spoken = (iso: string) => dates().spokenDate.format(parseISODate(iso));

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(MORNING);
    mockMutateAsync.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers two day rows and no slider', () => {
    renderForm();
    expect(screen.getByText('When')).toBeTruthy();
    expect(screen.getByText('Comes down')).toBeTruthy();
    expect(screen.getByLabelText(/^Pick the day this plan is for\. Currently /)).toBeTruthy();
    expect(screen.getByLabelText(/^Pick the day this comes down\. Currently /)).toBeTruthy();
    expect(screen.queryByLabelText('How long this pin stays up')).toBeNull();
    expect(screen.queryByText(/Disappears after/)).toBeNull();
  });

  it("posts the plan's own day as the take-down until somebody picks another, and never a timestamp", async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    const input = mockMutateAsync.mock.calls[0][0];
    expect(input.takeDownOn).toBe(input.intentDate);
    expect(input).not.toHaveProperty('expiresAt');
  });

  it('a take-down before the plan draws one calm line and blocks nothing', async () => {
    renderForm();
    // The plan moves to the 18th through its calendar...
    fireEvent.press(screen.getByTestId('pin-when'));
    fireEvent.press(screen.getByLabelText(spoken('2026-09-18')));
    // ...and the take-down, which followed it there, is pulled back to the 14th.
    fireEvent.press(screen.getByTestId('pin-take-down'));
    fireEvent.press(screen.getByLabelText(spoken('2026-09-14')));

    // ONE line, footnote weight, both dates. Not a warning, nothing red.
    expect(
      screen.getByText(
        `It comes down on ${formatDate('2026-09-14')}, before the plan on ${formatDate('2026-09-18')}. People can find it until then.`
      )
    ).toBeTruthy();
    // Nothing blocked: the hour rails are still offered in full for the
    // plan's day, the button is live, and there is no confirmation to clear.
    expect(screen.getByTestId('time-19:00')).toBeTruthy();
    fireEvent.press(screen.getByTestId('time-19:00'));
    expect(screen.getByTestId('until-03:00')).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentDate: '2026-09-18',
      takeDownOn: '2026-09-14',
      intentTime: '19:00',
    });
  });

  it('the reminder is absent while the take-down is on or after the plan', () => {
    renderForm();
    fireEvent.press(screen.getByTestId('pin-take-down'));
    fireEvent.press(screen.getByLabelText(spoken('2026-09-25')));
    expect(screen.queryByText(/before the plan on/)).toBeNull();
    expect(screen.getByText(new RegExp(`up until ${formatDate('2026-09-25')}`))).toBeTruthy();
  });
});
