import { useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Motion, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

const TRACK_HEIGHT = 36;
const INSET = 3;
/**
 * What the tabs are worth touching by.
 *
 * A 36pt track with 3pt of padding leaves each tab 30pt tall, ten under the
 * floor - and this control now carries the whole of two date surfaces, where
 * missing the tab you meant is a trip with the wrong dates on it. The track
 * keeps the height it looks right at and the target grows past it, which is
 * the same trade the verified seal and the photo grid's remove dot already
 * make. Vertical only: sideways slop would overlap the neighbouring tab.
 */
const TAB_SLOP = Math.max(0, Math.ceil((HitTarget - (TRACK_HEIGHT - INSET * 2)) / 2));

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
            hitSlop={{ top: TAB_SLOP, bottom: TAB_SLOP }}
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
    // minHeight, not height: the labels scale with Dynamic Type and a fixed
    // box clips them at the larger sizes.
    minHeight: TRACK_HEIGHT,
    padding: INSET,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  thumb: {
    position: 'absolute',
    // 1.5pt, not a hairline. The thumb fill is #20243D on #171A2E — 1.13:1,
    // nothing anyone can see — so this edge is the control's primary signal,
    // and a 3.4:1 colour drawn 0.33pt wide at 3x was a sub-pixel whisper on
    // the tab people switch most. The contrast is spent on the edge because
    // no fill in the palette clears the 3:1 floor without shouting.
    borderWidth: 1.5,
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
