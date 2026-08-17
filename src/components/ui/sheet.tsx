import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
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
}: {
  children: ReactNode;
  onClose: () => void;
  dimmed?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const sheetWidth = Math.min(width, MaxContentWidth);

  return (
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
        entering={SlideInDown.duration(Motion.standard)}
        exiting={SlideOutDown.duration(Motion.quick)}
        style={[
          styles.sheet,
          Elevation.sheet,
          {
            width: sheetWidth,
            backgroundColor: theme.surface,
            paddingBottom: insets.bottom + Space.lg,
          },
        ]}>
        <View style={[styles.grabber, { backgroundColor: theme.hairline }]} />
        {children}
      </Animated.View>
    </View>
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
