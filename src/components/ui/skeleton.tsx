import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A shape where content is about to be.
 *
 * Used for the two lists people arrive at cold — Travelers and Chat — and
 * deliberately NOT for the map: a shimmering rectangle over a basemap reads
 * as a broken tile, and the map already has something true to show while it
 * loads, which is the map.
 *
 * The pulse is opacity only. A moving gradient costs a render pass per frame
 * on a list that is about to be replaced anyway.
 */
export function Skeleton({
  width,
  height,
  aspectRatio,
  radius = Radius.md,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  /**
   * For a block whose real height is a ratio of the screen width. A hardcoded
   * height for a hero photo is right on exactly one phone and wrong on every
   * other, so the photo landing kicked everything below it down by up to a
   * hundred points.
   */
  aspectRatio?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      // Inert to VoiceOver: announcing five empty boxes is worse than
      // announcing nothing while a screen loads.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        { width, height, aspectRatio, borderRadius: radius, backgroundColor: theme.surfaceSunken },
        animated,
        style,
      ]}
    />
  );
}

/** The shape of a chat row, for the list's first paint. */
export function ChatRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={48} height={48} radius={24} />
      <View style={styles.rowText}>
        <Skeleton width="55%" height={14} radius={Radius.sm} />
        <Skeleton width="80%" height={12} radius={Radius.sm} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
  },
  rowText: {
    flex: 1,
    gap: Space.sm,
  },
});
