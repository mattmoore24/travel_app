import type { ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { keyboardBarHeight } from '@/components/form/keyboard-done-bar';

/**
 * A full-height container that grows a keyboard-sized floor.
 *
 * KeyboardAvoidingView has to be told the height of whatever sits above it,
 * and both chat screens were telling it a hardcoded 90, which is not the
 * height of a native header on any particular phone. Its own frame is
 * measured relative to its PARENT, so that number lands about ten points
 * short: the composer sat under the keyboard, close enough to look almost
 * right and far enough that you could not see what you were typing. It is
 * also what stopped the E2E run from being able to type into a room at all.
 *
 * So ask the keyboard instead of guessing. Same move as components/ui/sheet,
 * which replaced the same class of guess for the same reason. The safe-area
 * inset comes back off because the keyboard's own height already covers the
 * home indicator, and the SafeAreaView around this still pays for it when the
 * keyboard is down.
 */
export function KeyboardFloor({
  children,
  allowance,
}: {
  children: ReactNode;
  /**
   * The height of whatever sits BELOW this floor that the keyboard is allowed
   * to cover, measured by the caller. The signup shell keeps its Continue,
   * skip and sign-out under the keyboard rather than lifting them (founder:
   * "have the keyboard go over them when the user is typing"), so its floor
   * only needs to grow by the part of the keyboard that reaches past that
   * footer. Without the allowance the content would shrink by the footer's
   * height twice: once for the footer that is still laid out beneath, and
   * again for the keyboard covering it. A shared value, because the footer's
   * own height moves (a note appears, Dynamic Type) and the style runs on the
   * UI thread.
   */
  allowance?: SharedValue<number>;
}) {
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  // The bar's height at THIS text size, computed on the JS thread and
  // captured by the worklet as a plain number: the bar grows with its label
  // up to the control cap, and a floor that added the default-size constant
  // left the bottom of that label under the keyboard at the accessibility
  // sizes, by exactly the amount the label had grown.
  const { fontScale } = useWindowDimensions();
  const barHeight = keyboardBarHeight(fontScale);
  const floor = useAnimatedStyle(() => {
    // THE BAR IS NOT IN THE NUMBER. Reanimated reports the keyboard's own
    // frame, and on iOS the input accessory view rides above it outside that
    // frame - so a floor sized to the keyboard alone left the Hide keyboard
    // bar lying across the bottom third of the Continue pill (run 109,
    // screen 60). Every field carries that bar now (KeyboardDone), so while
    // the keyboard is up the floor is taller by exactly its height.
    const bar = Platform.OS === 'ios' && keyboard.height.value > 0 ? barHeight : 0;
    return {
      paddingBottom: Math.max(
        keyboard.height.value + bar - insets.bottom - (allowance?.value ?? 0),
        0
      ),
    };
  });

  return <Animated.View style={[styles.flex, floor]}>{children}</Animated.View>;
}

/**
 * The Hide keyboard bar's height AT THE DEFAULT TEXT SIZE. The floor above
 * and the sheet's keyboard lift (components/ui/sheet) both read
 * `keyboardBarHeight(fontScale)` instead, because the bar grows with its
 * label; this constant stays for anything that needs the floor of the range
 * rather than the live value. Prefer the function anywhere a fontScale is
 * to hand.
 */
export const KEYBOARD_BAR_HEIGHT = keyboardBarHeight(1);

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
