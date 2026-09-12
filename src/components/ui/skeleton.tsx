import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { Radius, Space } from '@/constants/theme';
import { useCappedFontScale } from '@/hooks/use-capped-font-scale';
import { useTheme } from '@/hooks/use-theme';

/**
 * How far a text-line placeholder follows Dynamic Type. The skeleton is a
 * shape, not a paragraph: past twice the default the real row's height is
 * decided by wrapping this cannot guess, so growing further buys nothing.
 */
const TEXT_LINE_SCALE_CAP = 2;

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
  text = false,
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
  /**
   * This bar stands in for a LINE OF TEXT, so its height follows Dynamic
   * Type the way the text will. At the accessibility sizes a 14pt bar under
   * a 28pt line is half a row, and the swap from skeleton to content jumps
   * everything below it by the difference.
   */
  text?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const pulse = useSharedValue(0.5);
  // One of the app's only two infinite loops. With Reduce Motion on it holds
  // still at its mid point instead of pulsing forever.
  const reduceMotion = useReducedMotion();
  const lineScale = useCappedFontScale(TEXT_LINE_SCALE_CAP);
  const lineHeight = text && height != null ? Math.round(height * lineScale) : height;

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.75;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse, reduceMotion]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      // Inert to VoiceOver: announcing five empty boxes is worse than
      // announcing nothing while a screen loads.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        {
          width,
          height: lineHeight,
          aspectRatio,
          borderRadius: radius,
          backgroundColor: theme.surfaceSunken,
        },
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

/**
 * Four bubbles, top to bottom in reading order. The last one, nearest the
 * composer, is a sent bubble, which is where the eye lands in a thread.
 */
const THREAD_BUBBLES: { width: `${number}%`; sent: boolean }[] = [
  { width: '62%', sent: false },
  { width: '48%', sent: true },
  { width: '70%', sent: false },
  { width: '40%', sent: true },
];

/**
 * The shape of a conversation, for a thread's first paint.
 *
 * ONE View, and `inverted` for the message list. That list is an inverted
 * FlatList, which draws everything through a scaleY -1 so its first item
 * sits at the bottom, and everything inside it comes out mirrored,
 * ListEmptyComponent included (the traps skill's "Lists": an inverted list
 * flips a cell's children, so a pair has to be ordered inside one View).
 * VirtualizedList does try to hand the empty component a counter-flip, but
 * it arrives as a `style` prop cloned onto the element
 * (`_renderEmptyComponent`), and a component that takes no style drops it
 * on the floor, so the mirror is undone explicitly here instead. With the
 * list's flip and this one the View reads upright: the bubbles keep their
 * source order top to bottom, and the block sits against the composer,
 * where the newest messages will land. The room screen's empty state
 * carries the same transform for the same reason.
 */
export function ThreadSkeleton({ inverted = false }: { inverted?: boolean }) {
  return (
    <View style={[styles.thread, inverted && styles.unmirrored]}>
      {THREAD_BUBBLES.map((bubble, index) => (
        <Skeleton
          key={index}
          width={bubble.width}
          height={40}
          radius={Radius.bubble}
          style={bubble.sent ? styles.sent : styles.received}
        />
      ))}
    </View>
  );
}

/** One full-width row (a settings row, a list cell) at its resting height. */
export function RowSkeleton({ height = 56 }: { height?: number }) {
  return <Skeleton width="100%" height={height} radius={Radius.md} />;
}

/**
 * A form's first paint: `groups` labelled fields, each a short label line
 * over a field the height of FormTextField's box.
 */
export function FormSkeleton({ groups = 4 }: { groups?: number }) {
  return (
    <View style={styles.form}>
      {Array.from({ length: groups }, (_, index) => (
        <View key={index} style={styles.formGroup}>
          <Skeleton width="30%" height={12} radius={Radius.sm} text />
          <Skeleton width="100%" height={52} radius={Radius.sm} />
        </View>
      ))}
    </View>
  );
}

/**
 * The profile page before its profile: the hero and three lines under it.
 * The shape app/profile/[userId] draws, lifted so the owner's own page can
 * draw the same one; the two screens render the same component once the
 * data lands, so they should look the same while they wait for it.
 */
export function ProfileHeroSkeleton() {
  return (
    <View>
      {/* The hero is a ratio of the width, never a fixed height (see the
          aspectRatio prop). 1/1.15 is the shape the real hero draws
          (heroWidth * 1.15 in profile-view). */}
      <Skeleton aspectRatio={1 / 1.15} radius={0} />
      <View style={styles.heroText}>
        <Skeleton width="55%" height={20} radius={Radius.sm} text />
        <Skeleton width="80%" height={14} radius={Radius.sm} text />
        <Skeleton width="70%" height={14} radius={Radius.sm} text />
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
  thread: {
    gap: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  unmirrored: {
    transform: [{ scaleY: -1 }],
  },
  received: {
    alignSelf: 'flex-start',
  },
  sent: {
    alignSelf: 'flex-end',
  },
  form: {
    gap: Space.xl,
  },
  formGroup: {
    gap: Space.sm,
  },
  heroText: {
    gap: Space.md,
    padding: Space.lg,
  },
});
