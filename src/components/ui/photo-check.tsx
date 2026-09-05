import { Image } from 'expo-image';
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * How long people should expect to wait for a photo to clear.
 *
 * An estimate from the measured chain rather than a hope: the insert now pokes
 * the worker directly (20260828170000) instead of waiting on a once-a-minute
 * cron, chat photos drain before every other queue, and the classification
 * runs at low effort. That is a cold start, a signed URL and one vision call.
 *
 * `admin_moderation_latency` measures the real thing, per queue, over the last
 * seven days. When there is enough live traffic to read a p95 off it, this
 * number comes from there — and a promise nobody can keep is worse than no
 * promise, so if it turns out slower this says so instead.
 */
export const PHOTO_CHECK_SECONDS = 5;

/**
 * The "we are looking at this photo" card, over whatever is behind it.
 *
 * It was a chat bubble's private treatment, and the profile grid answered the
 * identical wait with the two words "In review" — the same fact, said twice,
 * in two voices, with only one of them saying why or for how long. This is
 * that one voice, and it renders as an absolute overlay so the caller keeps
 * ownership of the frame and of the picture underneath.
 *
 * The owner sees their own photo behind the veil (storage lets them read
 * their own upload before it clears); everybody else sees the frame.
 */
export function PhotoCheckVeil({
  compact = false,
  style,
}: {
  /** Small frames get the headline only; the sentence would not fit. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      // One element, one sentence. Without this VoiceOver reads a spinner, a
      // heading and a paragraph as three separate stops on a tile.
      accessible
      accessibilityLabel={
        compact
          ? 'Checking this photo.'
          : `Checking this photo. We check every photo before it goes out. Usually about ${PHOTO_CHECK_SECONDS} seconds.`
      }
      style={[StyleSheet.absoluteFill, styles.veil, { backgroundColor: theme.scrim }, style]}>
      {/* On a solid card, not straight onto the scrim. The scrim sits over
          the owner's own photo, so the effective background is whatever they
          photographed: textSecondary over a 0.62 veil on a bright picture
          measures 2.5:1, and no veil opacity fixes that without hiding the
          photo this card exists to show. A card makes the ratio the
          palette's, whatever is behind it. */}
      <View style={[styles.card, { backgroundColor: theme.surface }]}>
        <ActivityIndicator color={theme.textSecondary} />
        <ThemedText type="callout" style={styles.title}>
          Checking this photo
        </ThemedText>
        {compact ? null : (
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
            We check every photo before it goes out. Usually about {PHOTO_CHECK_SECONDS} seconds.
          </ThemedText>
        )}
      </View>
    </View>
  );
}

/**
 * A photo waiting on its verdict, at the size the photo itself will be.
 *
 * It used to be the words "Photo in review" in a text bubble — a tiny grey
 * rectangle that then jumped to 220pt square when the picture arrived, which
 * is the founder's "tiny bubble". Reserving the real frame means nothing in
 * the thread moves when the verdict lands, and saying WHY out loud is the
 * honest version of a blank space: every photo in this app is checked, and a
 * person who knows that is waiting rather than wondering.
 */
export function PhotoCheck({
  url,
  compact = false,
  style,
}: {
  url: string | null;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.frame, { backgroundColor: theme.surfaceSunken }, style]}>
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <PhotoCheckVeil compact={compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  veil: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.md,
  },
  card: {
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  title: {
    fontWeight: '600',
    textAlign: 'center',
  },
  note: {
    textAlign: 'center',
  },
});
