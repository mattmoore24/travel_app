import type { ReactNode } from 'react';
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
 * How long a Sheet takes to leave, from its exiting animation below. Anything
 * that has to wait for the sheet to be gone reads it from here so the two
 * cannot drift apart.
 */
export const SHEET_EXIT_MS = 320;

/**
 * Never push a route from inside a presented Sheet. The route goes into the
 * stack BELOW it while the sheet's full-screen scrim survives, so when the
 * person comes back every tap lands on an invisible overlay and the screen
 * looks dead. That is the map freeze the founder reported.
 *
 * Wrap the navigation in this instead: it dismisses the sheet first and goes
 * once the sheet has finished leaving.
 */
export function leavingSheet(close: () => void) {
  return (go: () => void) => {
    close();
    setTimeout(go, SHEET_EXIT_MS);
  };
}

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
  // A bottom-anchored sheet should make room for the keyboard, not slide up
  // over it. Translating worked for short sheets and failed badly for tall
  // ones — either the top ran off the screen, or (once clamped) it could not
  // move at all and its own button stayed buried. Growing the bottom padding
  // pushes the content up by exactly the keyboard's height, and the cap
  // below lets a long form's scroll area shrink instead of overflowing.
  const keyboardStyle = useAnimatedStyle(() => {
    const lift = avoidKeyboard ? keyboard.height.value : 0;
    return { paddingBottom: insets.bottom + Space.lg + lift };
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
            {/* "Dismiss", not "Close": sheets often contain their own Close
                button, and two identical labels are ambiguous to VoiceOver
                and to anything driving the app. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
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
              maxHeight: height - insets.top - Space.lg,
            },
            keyboardStyle,
          ]}>
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
