import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';
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
export function KeyboardFloor({ children }: { children: ReactNode }) {
  const keyboard = useAnimatedKeyboard();
  const insets = useSafeAreaInsets();
  const floor = useAnimatedStyle(() => ({
    paddingBottom: Math.max(keyboard.height.value - insets.bottom, 0),
  }));

  return <Animated.View style={[styles.flex, floor]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
