import { SymbolView } from 'expo-symbols';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { create } from 'zustand';

import { PressableScale } from '@/components/ui/pressable-scale';
import { ThemedText } from '@/components/themed-text';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { profileGaps, type ProfileGap } from '@/features/profile/completion';
import { useTheme } from '@/hooks/use-theme';
import { countOf } from '@/lib/plural';

/**
 * Dismissed for the SESSION, in memory, and never persisted.
 *
 * This is the third surface asking for the same six answers, after the funnel
 * and the editors. If it cannot be put away it becomes a nag on the one
 * screen a person owns; if it stayed away forever it would be a feature
 * somebody turned off by accident on day one. In memory is the honest middle:
 * gone for as long as they are in the app, back on the next launch, and gone
 * for good the moment the last gap closes.
 */
const useFinishCard = create<{ dismissed: boolean; dismiss: () => void }>((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

function openGap(gap: ProfileGap) {
  if (gap.section != null) {
    router.push({ pathname: gap.route, params: { section: gap.section } });
    return;
  }
  router.push(gap.route);
}

/**
 * The second ask for the sections signup was allowed to skip.
 *
 * Every row hands over to the editor that already owns that section, which
 * are the same routes onboarding pushes to, so there is one place each answer
 * is written and this is a door rather than a fourth form.
 *
 * Renders NOTHING when there are no gaps. That case is the important one: a
 * finished profile must not be offered a card telling it to finish.
 */
export function FinishYourProfileCard({
  profile,
  prompts,
  priorities,
  trips,
  handles,
}: {
  profile: { bio: string | null; occupation: string | null };
  prompts: unknown[];
  priorities: unknown[];
  trips: unknown[];
  handles: unknown[];
}) {
  const theme = useTheme();
  const dismissed = useFinishCard((s) => s.dismissed);
  const dismiss = useFinishCard((s) => s.dismiss);
  const { gaps, count } = profileGaps({ profile, prompts, priorities, trips, handles });

  if (dismissed || count === 0) {
    return null;
  }

  return (
    <View style={[styles.card, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <ThemedText type="headline">Finish your profile</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            {`${countOf(count, 'thing')} you passed on the way in. A minute each.`}
          </ThemedText>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Hide this"
          accessibilityHint="Puts the list away until you next open the app."
          haptic="light"
          scaleTo={0.9}
          hitSlop={6}
          onPress={dismiss}
          style={styles.dismiss}>
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={14}
            tintColor={theme.textSecondary}
          />
        </PressableScale>
      </View>
      {gaps.map((gap) => (
        <PressableScale
          key={gap.key}
          accessibilityRole="button"
          // The row's own words, spoken. A Pressable with a label REPLACES
          // its children for VoiceOver, so a generic label here would hide
          // the only thing on the row worth hearing.
          accessibilityLabel={`${gap.title}. ${gap.body}`}
          haptic="light"
          scaleTo={0.98}
          onPress={() => openGap(gap)}>
          <View style={[styles.row, { backgroundColor: theme.surfaceSunken }]}>
            <View style={styles.rowText}>
              <ThemedText type="callout">{gap.title}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {gap.body}
              </ThemedText>
            </View>
            <SymbolView
              name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              size={14}
              tintColor={theme.textSecondary}
            />
          </View>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.md,
    padding: Space.lg,
    gap: Space.sm,
    borderCurve: 'continuous',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  headerText: {
    flex: 1,
    gap: Space.xs,
  },
  dismiss: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -Space.md,
    marginRight: -Space.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.md,
    paddingHorizontal: Space.md,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
    gap: Space.xs,
  },
});
