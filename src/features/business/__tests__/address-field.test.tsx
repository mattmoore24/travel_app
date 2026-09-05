import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { BusinessAddressField } from '@/features/business/address-field';
import { searchPlaces } from '@/modules/local-search';

/**
 * A business typing its own address, anywhere on earth.
 *
 * Three rules from 2026-09-05, when the launch-city fence came down for
 * businesses (20260905130000): the box asks for the city in the words,
 * because no city is chosen anywhere on the screen; the search runs only
 * while the box has focus, so walking back to a settled address never pops
 * a list under it; and the small line under the box is the other way in,
 * shown only while the parent still wants one.
 */

jest.mock('@/modules/local-search', () => ({
  venueSearchAvailable: true,
  searchPlaces: jest.fn(),
}));
jest.mock('expo-location', () => ({ geocodeAsync: jest.fn().mockResolvedValue([]) }));
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
jest.mock('@/lib/haptics', () => ({
  haptics: { light: jest.fn(), selection: jest.fn(), soft: jest.fn() },
}));

const mockSearchPlaces = searchPlaces as jest.MockedFunction<typeof searchPlaces>;

/** Past the hook's 280 ms debounce, with room to spare. */
const WELL_PAST_DEBOUNCE_MS = 1000;

const PLACEHOLDER = 'Street, number and city';
const SET_PIN = 'Not coming up? Set the pin yourself.';

beforeEach(() => {
  jest.useFakeTimers();
  mockSearchPlaces.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

function renderField(over: Partial<React.ComponentProps<typeof BusinessAddressField>> = {}) {
  const props = {
    value: '',
    onChangeText: jest.fn(),
    onPick: jest.fn(),
    ...over,
  };
  const view = render(<BusinessAddressField {...props} />);
  return { ...view, props };
}

describe('BusinessAddressField', () => {
  it('asks for the city in the words, because nothing else on the screen picks one', () => {
    renderField();
    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeTruthy();
    expect(screen.getByLabelText('Your address')).toBeTruthy();
  });

  it('does not search for an address it was mounted with, and not until focused', async () => {
    // Walking back from "Is this right?" mounts the field with the address
    // already in it. That is showing an address back, not typing one.
    const { props, rerender } = renderField({ value: 'Rua da Rosa 12' });
    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_DEBOUNCE_MS);
    });
    expect(mockSearchPlaces).not.toHaveBeenCalled();

    // Typing hands the words to the parent, which owns them...
    const input = screen.getByLabelText('Your address');
    fireEvent.changeText(input, 'Rua da Rosa 12, Lisboa');
    expect(props.onChangeText).toHaveBeenCalledWith('Rua da Rosa 12, Lisboa');
    rerender(<BusinessAddressField {...props} value="Rua da Rosa 12, Lisboa" />);
    // ...but with the box unfocused nothing is searched for, however long
    // the pause.
    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_DEBOUNCE_MS);
    });
    expect(mockSearchPlaces).not.toHaveBeenCalled();

    // Focus is what turns the search on.
    fireEvent(input, 'focus');
    await act(async () => {
      jest.advanceTimersByTime(WELL_PAST_DEBOUNCE_MS);
    });
    expect(mockSearchPlaces).toHaveBeenCalledTimes(1);
    expect(mockSearchPlaces).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Rua da Rosa 12, Lisboa' })
    );
  });

  it('tells the parent about focus both ways', () => {
    const onFocusChange = jest.fn();
    renderField({ onFocusChange });
    const input = screen.getByLabelText('Your address');
    fireEvent(input, 'focus');
    expect(onFocusChange).toHaveBeenLastCalledWith(true);
    fireEvent(input, 'blur');
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
  });

  it('shows the small line only when there is a parent to hand the pin to', () => {
    const { unmount } = renderField();
    expect(screen.queryByTestId('business-set-pin-yourself')).toBeNull();
    expect(screen.queryByText(SET_PIN)).toBeNull();
    unmount();

    renderField({ onSetPin: jest.fn() });
    const line = screen.getByTestId('business-set-pin-yourself');
    expect(line.props.accessibilityRole).toBe('button');
    expect(line.props.accessibilityLabel).toBe(SET_PIN);
    expect(screen.getByText(SET_PIN)).toBeTruthy();
  });

  it('pressing it blurs first, then hands over nothing when the list had nothing', () => {
    const order: string[] = [];
    const onFocusChange = jest.fn((focused: boolean) => order.push(`focus:${focused}`));
    const onSetPin = jest.fn((near: unknown) => order.push(`pin:${JSON.stringify(near)}`));
    renderField({ onFocusChange, onSetPin });

    fireEvent(screen.getByLabelText('Your address'), 'focus');
    expect(order).toEqual(['focus:true']);

    fireEvent.press(screen.getByTestId('business-set-pin-yourself'));
    // The step gets out of the way before the map is asked for, and with no
    // suggestion to start from the map is told so rather than guessed for.
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
    expect(onSetPin).toHaveBeenCalledTimes(1);
    expect(onSetPin).toHaveBeenCalledWith(null);
    expect(order).toEqual(['focus:true', 'focus:false', 'pin:null']);
  });
});
