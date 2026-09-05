import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space, Springs } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

const TRACK_HEIGHT = 6;
const KNOB = 28;

/**
 * A whole-number slider, for the one place this app needs one: how many
 * hours a pin stays up. Chips could offer four durations; the founder wanted
 * every hour between one and seventy-two, and seventy-two chips is not a
 * control.
 *
 * The knob is driven on the UI thread so dragging never stutters behind a
 * re-render, and only the settled value crosses back to React.
 */
export function HoursSlider({
  value,
  min,
  max,
  onChange,
  formatValue,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  formatValue: (value: number) => string;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  // Where the drag started, so a pan is relative rather than a jump.
  const startX = useSharedValue(0);
  const dragX = useSharedValue<number | null>(null);

  const span = Math.max(1, max - min);
  const usable = Math.max(0, trackWidth - KNOB);
  const restingX = ((clamp(value, min, max) - min) / span) * usable;

  const commit = (x: number) => {
    if (usable <= 0) {
      return;
    }
    const next = clamp(Math.round(min + (x / usable) * span), min, max);
    if (next !== value) {
      haptics.selection();
      onChange(next);
    }
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = dragX.value ?? restingX;
      dragX.value = startX.value;
    })
    .onUpdate((event) => {
      const next = Math.min(Math.max(startX.value + event.translationX, 0), usable);
      dragX.value = next;
      runOnJS(commit)(next);
    })
    .onFinalize(() => {
      dragX.value = null;
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragX.value ?? withSpring(restingX, Springs.release) },
      { scale: dragX.value == null ? 1 : 1.12 },
    ],
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: (dragX.value ?? restingX) + KNOB / 2,
  }));

  const onLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  return (
    <View
      // One element, or none: a View is not an accessibility element on iOS
      // unless it says so. Without this the label, the value and the two
      // actions below were set on nothing; VoiceOver landed on the readout's
      // text with no control to adjust, and E2E run 122 found no slider.
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value, text: formatValue(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        const step = event.nativeEvent.actionName === 'increment' ? 1 : -1;
        onChange(clamp(value + step, min, max));
      }}
      style={styles.wrap}>
      <View style={styles.readout}>
        <ThemedText type="headline">{formatValue(value)}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {formatValue(min)} to {formatValue(max)}
        </ThemedText>
      </View>
      <GestureDetector gesture={pan}>
        {/* Tall enough to grab: the visible track is 6pt, the target is 44. */}
        <View style={styles.touchArea} onLayout={onLayout}>
          <View style={[styles.track, { backgroundColor: theme.surfaceSunken }]} />
          <Animated.View
            style={[styles.fill, fillStyle, { backgroundColor: theme.accent }]}
            pointerEvents="none"
          />
          <Animated.View
            style={[
              styles.knob,
              knobStyle,
              { backgroundColor: theme.accent, borderColor: theme.canvas },
            ]}
            pointerEvents="none"
          />
        </View>
      </GestureDetector>
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const styles = StyleSheet.create({
  wrap: {
    gap: Space.xs,
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  touchArea: {
    height: HitTarget,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
  },
  knob: {
    position: 'absolute',
    left: 0,
    width: KNOB,
    height: KNOB,
    borderRadius: Radius.pill,
    borderWidth: 3,
  },
});
