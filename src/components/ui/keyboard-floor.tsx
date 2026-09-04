import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
  const floor = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value - insets.bottom - (allowance?.value ?? 0), 0),
  }));

  return <Animated.View style={[styles.flex, floor]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
