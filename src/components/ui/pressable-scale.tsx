import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { Springs } from '@/constants/theme';
import { haptics } from '@/lib/haptics';

type PressableScaleProps = Omit<PressableProps, 'children'> & {
  children?: React.ReactNode;
  /** Scale while pressed. Cards want 0.98, small controls 0.92. */
  scaleTo?: number;
  /** Haptic on touch-down; 'none' for rows inside scrollers. */
  haptic?: 'selection' | 'soft' | 'light' | 'none';
  style?: StyleProp<ViewStyle>;
  /**
   * Layout styles for the outer Pressable (e.g. alignSelf, flex) — layout
   * is the outer view's job, visuals and the scale are the inner view's.
   */
  containerStyle?: StyleProp<ViewStyle>;
};

/**
 * The one press feel for the whole app: a quick spring down on touch, a
 * slightly bouncier spring back on release, and a haptic on the way in.
 * Replaces the ad-hoc `opacity: 0.7` pressed styles (docs/DESIGN.md).
 *
 * Structure matters on the new architecture: transforms participate in
 * hit-testing, so the scale lives on an INNER view while the Pressable
 * keeps a static hit rect — otherwise the button shrinks its own touch
 * target mid-press and drops taps.
 */
export function PressableScale({
  scaleTo = 0.96,
  haptic = 'none',
  onPressIn,
  onPressOut,
  style,
  containerStyle,
  children,
  ...rest
}: PressableScaleProps) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Pressable
      {...rest}
      style={containerStyle}
      onPressIn={(event) => {
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable by contract
        scale.value = withSpring(scaleTo, Springs.press);
        if (haptic !== 'none') {
          haptics[haptic]();
        }
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutable by contract
        scale.value = withSpring(1, Springs.release);
        onPressOut?.(event);
      }}>
      <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>
    </Pressable>
  );
}
