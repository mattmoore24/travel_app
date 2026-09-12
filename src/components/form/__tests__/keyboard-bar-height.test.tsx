import { render, screen } from '@testing-library/react-native';
import { InputAccessoryView, StyleSheet, TextInput, View } from 'react-native';

import { KeyboardDone, keyboardBarHeight } from '@/components/form/keyboard-done-bar';
import { KEYBOARD_BAR_HEIGHT } from '@/components/ui/keyboard-floor';
import { FontCap, Space, Type } from '@/constants/theme';
import { capFontScale } from '@/hooks/use-capped-font-scale';
import { between, source } from '@/lib/__tests__/source';

/**
 * The bar's height is one number, and the bar, the floor and the label's
 * cap all read it.
 *
 * The floor adds the bar's height while the keyboard is up (keyboard-floor:
 * the keyboard's reported frame does not include the accessory view). It
 * used to add a constant measured at the default text size, so at the
 * accessibility sizes the bar's label grew, the bar grew with it, and the
 * floor did not: the bottom of "Hide keyboard" sat under the keyboard by
 * exactly the amount the label had grown. Now the label is capped, the bar's
 * minHeight is derived from that cap, and the floor calls the same function
 * with the live fontScale. These pin all three to each other.
 */

let mockFontScale = 1;

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

const show = () =>
  render(<KeyboardDone>{(done) => <TextInput {...done} autoCorrect={false} />}</KeyboardDone>);

const barStyle = () => {
  const bar = screen.UNSAFE_getByType(InputAccessoryView).findByType(View);
  return StyleSheet.flatten(bar.props.style) as Record<string, unknown>;
};

describe('keyboardBarHeight', () => {
  it('is a capped callout line plus the padding above and below it', () => {
    for (const fontScale of [0.8, 1, 1.3, 1.5, 2, 3]) {
      expect(keyboardBarHeight(fontScale)).toBe(
        Space.sm * 2 + Type.callout.lineHeight * capFontScale(fontScale, FontCap.control)
      );
    }
  });

  it('is 36 at the default size, which is the floor of the range', () => {
    expect(keyboardBarHeight(1)).toBe(36);
    expect(KEYBOARD_BAR_HEIGHT).toBe(keyboardBarHeight(1));
  });

  it('stops growing at the control cap', () => {
    expect(keyboardBarHeight(2)).toBe(keyboardBarHeight(FontCap.control));
    expect(keyboardBarHeight(2)).toBeGreaterThan(keyboardBarHeight(1));
  });
});

describe('the bar is as tall as the function says, and its label is capped the same way', () => {
  it('at the default size', () => {
    mockFontScale = 1;
    show();
    expect(barStyle().minHeight).toBe(keyboardBarHeight(1));
    expect(screen.getByText('Hide keyboard').props.maxFontSizeMultiplier).toBe(FontCap.control);
  });

  it('at an accessibility size', () => {
    mockFontScale = 2.2;
    show();
    expect(barStyle().minHeight).toBe(keyboardBarHeight(2.2));
    expect(barStyle().minHeight).toBe(Space.sm * 2 + Type.callout.lineHeight * FontCap.control);
  });
});

describe('the floor reads the live number, not the default-size constant', () => {
  it('captures keyboardBarHeight(fontScale) for the worklet', () => {
    const code = source('src/components/ui/keyboard-floor.tsx');
    const body = between(code, 'export function KeyboardFloor', 'return <Animated.View');
    expect(body).toContain('const { fontScale } = useWindowDimensions();');
    expect(body).toContain('const barHeight = keyboardBarHeight(fontScale);');
    const worklet = between(body, 'const floor = useAnimatedStyle', '});');
    expect(worklet).toContain('? barHeight : 0');
    expect(worklet).not.toContain('KEYBOARD_BAR_HEIGHT');
  });
});
