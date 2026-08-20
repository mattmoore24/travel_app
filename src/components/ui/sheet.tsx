import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Elevation, MaxContentWidth, Motion, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The default container for anything that doesn't deserve a full screen —
 * previews, detail, confirmations (docs/DESIGN.md; it's the 2026 convention
 * and what iOS standardised). Tap-outside dismisses; the grabber says
 * "draggable" even before we add the gesture.
 */
export function Sheet({
  children,
  onClose,
  dimmed = true,
  avoidKeyboard = false,
}: {
  children: ReactNode;
  onClose: () => void;
  dimmed?: boolean;
  /** Lift the sheet above the keyboard — for sheets that contain inputs. */
  avoidKeyboard?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const sheetWidth = Math.min(width, MaxContentWidth);
  const keyboard = useAnimatedKeyboard();
  const [sheetHeight, setSheetHeight] = useState(0);
  // Clamped against the sheet's own measured height: an unclamped lift
  // pushes a tall sheet clean off the top of the screen, which is what made
  // the pin form unreadable while typing. It rises as far as the keyboard
  // needs and no further than the safe area.
  const maxLift = Math.max(0, height - insets.top - sheetHeight);
  const keyboardStyle = useAnimatedStyle(() => {
    const lift = avoidKeyboard ? Math.max(0, keyboard.height.value - insets.bottom) : 0;
    return { transform: [{ translateY: -Math.min(lift, maxLift) }] };
  });

  return (
    // Through a Modal on purpose: a sheet is often rendered from deep inside
    // a form or a scroll view, and an absolutely-positioned root resolves
    // against its PARENT, not the screen — which anchored the gender
    // dropdown to its own field box and the trip editor to the bottom of the
    // profile's scroll content.
    <Modal transparent visible statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {dimmed ? (
          <Animated.View
            entering={FadeIn.duration(Motion.quick)}
            exiting={FadeOut.duration(Motion.quick)}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={StyleSheet.absoluteFill}
              onPress={onClose}
            />
          </Animated.View>
        ) : null}

        <Animated.View
          // The iOS system-sheet spring (SwiftUI response .55 / damping .825
          // converted); dismissal is quicker than presentation by convention.
          entering={SlideInDown.springify().mass(1).stiffness(130).damping(19)}
          exiting={SlideOutDown.duration(200)}
          style={[
            styles.sheet,
            Elevation.sheet,
            {
              width: sheetWidth,
              backgroundColor: theme.surface,
              paddingBottom: insets.bottom + Space.lg,
            },
            keyboardStyle,
          ]}
          onLayout={(event) => setSheetHeight(event.nativeEvent.layout.height)}>
          <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    gap: Space.md,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: Space.xs,
  },
});
