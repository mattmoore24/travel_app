import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { FontCap } from '@/constants/theme';
import { TripCalendar, cellSize } from '@/features/trips/trip-calendar';

/**
 * The calendar grid follows the digits, and both stop at the control cap.
 *
 * A calendar is a fixed composition: forty-two cells in seven columns, a
 * selection disc inside each. The digits used to scale fully while the cell
 * and the disc stayed at their default-size numbers, so at AX5 a 47pt digit
 * sat over a 34pt disc and the row below it. Now the digits and the weekday
 * letters are capped at FontCap.control and the cell reads the same clamp,
 * so the disc is always big enough for the number in it and never bigger
 * than the row it stands in.
 */

let mockFontScale = 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

const day = (n: number) =>
  new Date(2026, 7, n).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

const show = () =>
  render(
    <TripCalendar start={null} end={null} minISO="2026-08-01" months={1} onChange={jest.fn()} />
  );

/** The cell is the button's container; the disc is the view holding the digit. */
const cellOf = (label: string) => {
  const button = screen.getByLabelText(label);
  // PressableScale's containerStyle lands on the outer view, which is the
  // button's own parent.
  return StyleSheet.flatten(button.parent?.props.style) as Record<string, unknown>;
};

const discOf = (label: string) => {
  const digit = screen.getByLabelText(label).findByProps({ children: 10 });
  return StyleSheet.flatten(digit.parent?.props.style) as Record<string, unknown>;
};

describe('cellSize', () => {
  it('is the 40pt grid at the default size and below it', () => {
    expect(cellSize(1)).toBe(40);
    expect(cellSize(0.82)).toBe(40);
  });

  it('grows with the text and stops at the control cap', () => {
    expect(cellSize(1.3)).toBe(52);
    expect(cellSize(FontCap.control)).toBe(60);
    expect(cellSize(2)).toBe(cellSize(FontCap.control));
    expect(cellSize(3.1)).toBe(cellSize(FontCap.control));
  });
});

describe('the grid at an accessibility size', () => {
  it('sizes every cell and disc from the same clamp the digits use', () => {
    mockFontScale = 3.1;
    show();
    const cell = cellOf(day(10));
    expect(cell.height).toBe(cellSize(3.1));
    const disc = discOf(day(10));
    expect(disc.width).toBe(cellSize(3.1) - 6);
    expect(disc.height).toBe(cellSize(3.1) - 6);
  });

  it('caps the digits and the weekday letters at the control cap', () => {
    mockFontScale = 3.1;
    show();
    const digit = screen.getByLabelText(day(10)).findByProps({ children: 10 });
    expect(digit.props.maxFontSizeMultiplier).toBe(FontCap.control);
    // Seven letters, and the two Saturdays and two Tuesdays share a letter.
    for (const letter of screen.getAllByText(/^[SMTWF]$/)) {
      expect(letter.props.maxFontSizeMultiplier).toBe(FontCap.control);
    }
  });

  it('keeps the default grid at the default size', () => {
    mockFontScale = 1;
    show();
    expect(cellOf(day(10)).height).toBe(40);
    expect(discOf(day(10)).width).toBe(34);
  });
});
