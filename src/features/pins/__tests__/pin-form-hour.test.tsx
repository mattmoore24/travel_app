import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PinFormSheet } from '@/features/pins/pin-form-sheet';
import { intentTimeLabel } from '@/features/pins/pin-helpers';

/**
 * The hour, end to end through the form.
 *
 * A column nothing writes is a column nobody has: this is the test that says
 * the control is MOUNTED, that it starts on "Any time" with nothing chosen,
 * and that what somebody picks reaches the mutation as `intentTime`. The
 * database's own guards are pgTAP's half (56_a_pin_carries_an_hour).
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

  it('offers a time rail that starts on "Any time"', () => {
    renderForm();
    expect(screen.getByText('Time')).toBeTruthy();
    expect(screen.getByText('Any time')).toBeTruthy();
  });

  // OPTIONAL MEANS OPTIONAL. A pre-filled hour would make every "sometime
  // that evening" plan a small lie the poster has to notice and undo.
  it('posts no hour at all when nobody picks one', async () => {
    renderForm();
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ intentTime: null });
  });

  it('carries the hour somebody picked into the pin', async () => {
    renderForm();
    fireEvent.press(screen.getByText(intentTimeLabel('19:00')!));
    fireEvent.changeText(screen.getByTestId('plan-input'), 'Sunset drinks');
    fireEvent.press(screen.getByText('Put it on the map'));
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    expect(mockMutateAsync.mock.calls[0][0]).toMatchObject({ intentTime: '19:00' });
  });

  // The readout above the button is the only place the choice is echoed once
  // the rail has scrolled, and it must never read as a presence claim.
  it('echoes the choice as a plan rather than a position', () => {
    renderForm();
    fireEvent.press(screen.getByText(intentTimeLabel('19:00')!));
    const readout = `Today at ${intentTimeLabel('19:00')}`;
    expect(screen.getByText(new RegExp(readout))).toBeTruthy();
  });
});
