import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space, Spacing } from '@/constants/theme';
import { AUDIENCE_LABEL, audienceInSentence } from '@/features/profile/audience';
import { useTheme } from '@/hooks/use-theme';
import type { ProfileAudience } from '@/lib/database.types';

/**
 * "Your audience is narrowed", on the map, with a way back to the picker.
 *
 * The map used to thin out and say nothing at all. Its empty banner covers
 * the case where every pin goes; this covers the commoner one, where some go
 * and the map just looks like a quiet city. The date filter removes fewer
 * pins than this does and has had three chips announcing it all along.
 *
 * A shortcut rather than a fourth filter: it is drawn selected because it IS
 * on, and the only thing it does is open the screen that turned it on.
 *
 * Its own component so it can be rendered in a test. The map screen cannot
 * be: it mounts react-native-maps.
 */
export function AudienceChip({ audience }: { audience: ProfileAudience }) {
  const theme = useTheme();
  if (audience === 'everyone') {
    return null;
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Showing ${audienceInSentence(audience)}. Change who you see.`}
      accessibilityState={{ selected: true }}
      // Drawn at 30pt over a map that needs the room; the target is 44.
      hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
      haptic="selection"
      scaleTo={0.94}
      onPress={() => router.push('/visibility')}>
      <View style={[styles.chip, { backgroundColor: theme.accent }]}>
        <SymbolView
          name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
          size={12}
          tintColor={theme.onAccent}
        />
        <ThemedText type="footnote" style={{ color: theme.onAccent, fontWeight: '700' }}>
          {AUDIENCE_LABEL[audience]}
        </ThemedText>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
});
