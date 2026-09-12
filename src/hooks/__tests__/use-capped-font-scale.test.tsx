import { renderHook } from '@testing-library/react-native';

import { capFontScale, useCappedFontScale } from '@/hooks/use-capped-font-scale';

/**
 * The layout half of a FontCap: floored at 1, stopped at the cap. Mocked at
 * the module because React Native's jest DeviceInfo reports fontScale 2 and
 * the floor and the cap both need a value on their own side of it.
 */

let mockFontScale = 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

describe('useCappedFontScale', () => {
  it('passes a scale under the cap through', () => {
    mockFontScale = 1.3;
    expect(renderHook(() => useCappedFontScale(1.5)).result.current).toBe(1.3);
  });

  it('stops at the cap', () => {
    mockFontScale = 2.4;
    expect(renderHook(() => useCappedFontScale(1.5)).result.current).toBe(1.5);
  });

  it('never goes below the default size', () => {
    // Smaller text must not shrink a 44pt target; chrome was drawn at the
    // default and treats it as its floor.
    mockFontScale = 0.85;
    expect(renderHook(() => useCappedFontScale(1.5)).result.current).toBe(1);
  });
});

describe('capFontScale', () => {
  it.each([
    [1, 1.5, 1],
    [1.2, 1.5, 1.2],
    [1.5, 1.5, 1.5],
    [3, 1.5, 1.5],
    [0.8, 1.5, 1],
    [3, 2, 2],
  ])('clamps %s under cap %s to %s', (fontScale, cap, expected) => {
    expect(capFontScale(fontScale, cap)).toBe(expected);
  });
});
