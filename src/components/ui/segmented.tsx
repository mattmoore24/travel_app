import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Motion, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

const TRACK_HEIGHT = 36;
const INSET = 3;

/**
 * The iOS segmented control, in this app's palette: a sunken track, a raised
 * thumb that slides, and equal-width segments so the thumb's geometry is
 * arithmetic rather than a measurement race.
 *
 * Used where a screen holds two views of the same thing (individual chats
 * and group chats) — a place a big page title used to sit and say nothing.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const offset = useSharedValue(0);

  const segmentWidth = trackWidth > 0 ? (trackWidth - INSET * 2) / options.length : 0;

  const onLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setTrackWidth(width);
    const index = Math.max(
      0,
      options.findIndex((o) => o.value === value)
    );
    offset.value = ((width - INSET * 2) / options.length) * index;
  };

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: theme.surface }]}>
      {segmentWidth > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            thumbStyle,
            {
              width: segmentWidth,
              backgroundColor: theme.surfaceSunken,
              // border, not hairline: the thumb is the ONLY thing saying
              // which side is on, and #20243D on #171A2E is 1.13:1 — under
              // the 3:1 floor for a non-text indicator. #5E6499 draws the
              // edge at 3.4:1 against the ground.
              borderColor: theme.border,
            },
          ]}
        />
      ) : null}
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={
              option.badge != null && option.badge > 0
                ? `${option.label}, ${option.badge} unread`
                : option.label
            }
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) {
                return;
              }
              haptics.selection();
              offset.value = withTiming(segmentWidth * index, { duration: Motion.quick });
              onChange(option.value);
            }}
            style={styles.segment}>
            <ThemedText
              type="footnote"
              style={[styles.label, { color: selected ? theme.text : theme.textSecondary }]}>
              {option.label}
            </ThemedText>
            {/* A count on the side you are NOT looking at is the only way to
                know there is something over there. Announced through the
                tab's own label so VoiceOver says it once, not twice. */}
            {option.badge != null && option.badge > 0 ? (
              <View style={[styles.badge, { backgroundColor: theme.highlight }]}>
                <ThemedText type="caption" style={[styles.badgeText, { color: theme.background }]}>
                  {option.badge > 99 ? '99+' : option.badge}
                </ThemedText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    height: TRACK_HEIGHT,
    padding: INSET,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  thumb: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    top: INSET,
    left: INSET,
    bottom: INSET,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontWeight: '700',
  },
  label: {
    fontWeight: '600',
  },
});
