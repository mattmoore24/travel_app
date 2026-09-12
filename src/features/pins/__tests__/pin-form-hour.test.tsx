import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { intentTimeLabel } from '@/features/pins/pin-helpers';
import { formatDate, parseISODate } from '@/features/trips/dates';
import { dates } from '@/lib/locale';

/**
 * The hour, end to end through the form.
 *
 * A column nothing writes is a column nobody has: this is the test that says
 * the control is MOUNTED, that it starts with NOTHING in it (the founder:
 * "an optional field, not a preselected bubble"), and that what somebody
 * TYPES - a start, a window, or TBD - reaches the mutation read into HH:MM.
 * The reading itself is typed-time.test.ts; the database's own guards are
 * pgTAP's half (56_a_pin_carries_an_hour, 76_a_pin_goes_where_the_traveler
 * _goes).
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
// A 12-hour phone, which is the simulator's and most of the market's. The
// bare-hour test below depends on it; every other label in this file is
// computed through the same clock (intentTimeLabel), so nothing else does.
jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US', languageCode: 'en' }],
  getCalendars: () => [{ uses24hourClock: false, firstWeekday: 1, timeZone: 'UTC' }],
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

describe('the optional time on the pin form, typed', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] }).setSystemTime(MORNING);
    mockMutateAsync.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('offers two empty boxes and a TBD pill, and no preset hour to tap', () => {
    renderForm();
    expect(screen.getByText('Time (optional)')).toBeTruthy();
    expect(screen.getByTestId('pin-time-from').props.value).toBe('');
    expect(screen.getByTestId('pin-time-until').props.value).toBe('');
    expect(screen.getByTestId('time-tbd').props.accessibilityState.selected).toBe(false);
    // Founder, round 4: the preset time buttons are gone, and so is the old
    // "Any time" chip that once pre-answered the question.
    expect(screen.queryByTestId('time-19:00')).toBeNull();
    expect(screen.queryByText('Any time')).toBeNull();
    expect(screen.queryByText('Until (optional)')).toBeNull();
    // And the small text says whose clock the boxes are on (§7 rule 2: the
    // city's, never the phone's).
    expect(screen.getByText('Local time in Lisbon.')).toBeTruthy();
  });

  // OPTIONAL MEANS OPTIONAL. A pre-filled hour would make every "sometime
  // that evening" plan a small lie the poster has to notice and undo.
  it('posts no hour at all when nobody writes one', async () => {
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

  it('carries a typed start into the pin, read into HH:MM', async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7:30 pm');
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: '19:30',
      intentTimeEnd: null,
      timeTbd: false,
    });
  });

  it('a window: both boxes reach the pin, past midnight included', async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '10pm');
    fireEvent.changeText(screen.getByTestId('pin-time-until'), '2am');
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    // An end at or before the start is past midnight; the server reads it
    // as tomorrow (validate_pin), so the form sends it as typed.
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: '22:00',
      intentTimeEnd: '02:00',
      timeTbd: false,
    });
  });

  it('TBD is an answer of its own: it empties the boxes and reaches the pin as one', async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7:30 pm');
    fireEvent.press(screen.getByTestId('time-tbd'));
    expect(screen.getByTestId('time-tbd').props.accessibilityState.selected).toBe(true);
    // The database refuses TBD beside an hour (pins_tbd_names_no_hour), so
    // the form cannot hold both either.
    expect(screen.getByTestId('pin-time-from').props.value).toBe('');
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

  it('typing a time puts TBD out again', () => {
    renderForm();
    fireEvent.press(screen.getByTestId('time-tbd'));
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '8pm');
    expect(screen.getByTestId('time-tbd').props.accessibilityState.selected).toBe(false);
    expect(screen.getByText(new RegExp(`Today at ${intentTimeLabel('20:00')}`))).toBeTruthy();
  });

  // Never a silent post without the hour somebody meant to give: a box the
  // form cannot read holds the button, grey, with the footnote saying how.
  it('holds the button and says how to write a time it cannot read', () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.changeText(screen.getByTestId('pin-time-from'), 'seven-ish');
    expect(
      screen.getByText(`Write the time like ${intentTimeLabel('19:30')}, or leave it blank.`)
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Put it on the map'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
    // Clearing the box lets the plan post, without an hour.
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '');
    expect(screen.queryByText(/Write the time like/)).toBeNull();
  });

  it('holds the button while the start is already behind the city clock, and says so', () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '6am');
    expect(
      screen.getByText(
        `It's already past ${intentTimeLabel('06:00')} in Lisbon. Pick a later time.`
      )
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Put it on the map'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('asks for AM or PM when a bare hour is typed on a 12-hour phone', () => {
    // The test phone is 12-hour (jest-expo's expo-localization), and the
    // box beside the placeholder "7:30 PM" reading "7" as the morning is
    // exactly the lie the form refuses to tell.
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7');
    expect(
      screen.getByText(`Add AM or PM to the start, like ${intentTimeLabel('19:30')}.`)
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Put it on the map'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('reads a bare hour in the end box against the start, so "7pm to 11" is the night', async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7pm');
    fireEvent.changeText(screen.getByTestId('pin-time-until'), '11');
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({
      intentTime: '19:00',
      intentTimeEnd: '23:00',
    });
  });

  it('holds a window past twelve hours, which is a typo short of a day', () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7pm');
    fireEvent.changeText(screen.getByTestId('pin-time-until'), '6:59pm');
    expect(
      screen.getByText('A window can be up to 12 hours. Bring the end closer, or leave it blank.')
    ).toBeTruthy();
    // And the readout above the button does not print the refused end.
    expect(screen.getByText(new RegExp(`Today at ${intentTimeLabel('19:00')}`))).toBeTruthy();
    fireEvent.press(screen.getByText('Put it on the map'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('an end that is the start holds the button, since that would read as a whole day', () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7pm');
    fireEvent.changeText(screen.getByTestId('pin-time-until'), '19:00');
    expect(
      screen.getByText('The end is the same as the start. Give it a later time, or leave it blank.')
    ).toBeTruthy();
    fireEvent.press(screen.getByText('Put it on the map'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('an end with no start holds the button too', () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.changeText(screen.getByTestId('pin-time-until'), '10pm');
    expect(screen.getByText('Add a start time to go with that end.')).toBeTruthy();
    fireEvent.press(screen.getByText('Put it on the map'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  // The readout above the button is the only place the choice is echoed once
  // the boxes have scrolled, and it must never read as a presence claim.
  it('echoes the choice as a plan rather than a position', () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7:30pm');
    expect(screen.getByText(new RegExp(`Today at ${intentTimeLabel('19:30')}`))).toBeTruthy();
    fireEvent.changeText(screen.getByTestId('pin-time-until'), '10pm');
    expect(
      screen.getByText(
        new RegExp(`Today, ${intentTimeLabel('19:30')} to ${intentTimeLabel('22:00')}`)
      )
    ).toBeTruthy();
  });
});

/**
 * The day a pin disappears, through the form. Founder, 2026-09-10: the
 * traveler picks the date, a year at most, and a date BEFORE the plan is
 * legal — with "just small text ... to remind them of their choice".
 */
describe('the day a pin disappears, through the form', () => {
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
    expect(screen.getByText('Pin disappears')).toBeTruthy();
    expect(screen.getByLabelText(/^Pick the day this plan is for\. Currently /)).toBeTruthy();
    expect(screen.getByLabelText(/^Pick the day this pin disappears\. Currently /)).toBeTruthy();
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
        `The pin disappears on ${formatDate('2026-09-14')}, before the plan on ${formatDate('2026-09-18')}. People can find it until then.`
      )
    ).toBeTruthy();
    // Nothing blocked: an hour typed for the plan's day is still accepted,
    // the button is live, and there is no confirmation to clear.
    fireEvent.changeText(screen.getByTestId('pin-time-from'), '7pm');
    expect(screen.queryByText(/Pick a later time/)).toBeNull();
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
