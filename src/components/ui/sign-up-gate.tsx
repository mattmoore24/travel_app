import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass-surface';
import { Radius, Space } from '@/constants/theme';

/**
 * The moment we ask for an account — and the only one. Always states WHY, in
 * the words of the thing the person just tried to do, and never blocks
 * anything they could already see (docs/DESIGN.md, "ask for nothing until you
 * must").
 */
export function SignUpGate({
  reason,
  cta = 'Create an account',
  compact = false,
  onNavigate = (go) => go(),
}: {
  reason: string;
  cta?: string;
  compact?: boolean;
  /**
   * How to run the jump to sign-up. A caller that renders this INSIDE a sheet
   * must pass `leavingSheet(close)`, or the sheet's scrim outlives the push
   * and freezes whatever is behind it. See components/ui/sheet.
   */
  onNavigate?: (go: () => void) => void;
}) {
  return (
    <GlassSurface radius={Radius.xl} style={compact ? styles.compact : styles.card}>
      <View style={styles.inner}>
        <ThemedText type="headline">{reason}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Takes about a minute. Looking around is always free. You only need a profile to message
          people, drop pins or join a chat.
        </ThemedText>
        <PrimaryButton label={cta} onPress={() => onNavigate(() => router.push('/join'))} />
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: Space.lg,
  },
  compact: {
    marginHorizontal: Space.lg,
    marginTop: Space.sm,
  },
  inner: {
    gap: Space.md,
    padding: Space.lg,
  },
});
