import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import { useTopRated } from '@/features/business/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * The places somebody loved, on their profile.
 *
 * It pairs with Top priorities as BEEN against WANT, which is why it sits
 * just below the plans: where a traveler has been is context, and what they
 * want to do is the thing a stranger can say yes to.
 *
 * Renders NOTHING when the list is empty, including for the owner. An empty
 * section on a stranger's profile is noise, and the nudge to go and rate
 * things belongs on a place's own page, where there is something to rate.
 *
 * The visibility decision is the server's: top_rated_by refuses a profile the
 * viewer cannot see anyway, so a suspended or blocked traveler's shelf goes
 * dark with the rest of their page rather than surviving it.
 */
export function TopRatedShelf({ userId, cityId }: { userId: string; cityId: number | null }) {
  const theme = useTheme();
  const { data: places = [] } = useTopRated(userId, cityId);

  if (places.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <SymbolView
          name={{ ios: 'star.fill', android: 'star', web: 'star' }}
          size={15}
          tintColor={theme.textSecondary}
        />
        <ThemedText type="caption" themeColor="textSecondary" style={styles.title}>
          Been and loved
        </ThemedText>
      </View>
      <View style={styles.chipWrap}>
        {places.map((place) => (
          <PressableScale
            key={place.business_id}
            accessibilityRole="button"
            // The score is in the label because it is on the chip: a
            // screen reader that read only the name would be reading a
            // different chip from the one on screen.
            accessibilityLabel={`${place.name}, ${place.score.toFixed(1)}. Open it.`}
            haptic="light"
            scaleTo={0.96}
            // A footnote chip is about 30pt tall, so the target only clears
            // 44 with this.
            hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
            onPress={() => router.push(`/place/${place.business_id}`)}>
            <View style={[styles.chip, { backgroundColor: theme.surfaceSunken }]}>
              <ThemedText type="footnote">{place.name}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.score}>
                {place.score.toFixed(1)}
              </ThemedText>
            </View>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: Space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  title: {
    flex: 1,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Space.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  score: {
    // Scores line up when several chips wrap onto one row.
    fontVariant: ['tabular-nums'],
  },
});
