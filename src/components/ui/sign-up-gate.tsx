import { router } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { GlassSurface } from '@/components/ui/glass-surface';
import { Radius, Space } from '@/constants/theme';
import { analytics } from '@/lib/analytics';

/**
 * The moment we ask for an account — and the only one. Always states WHY, in
 * the words of the thing the person just tried to do, and never blocks
 * anything they could already see (docs/DESIGN.md, "ask for nothing until you
 * must").
 */
/**
 * One call to action, everywhere, and no prop to drift it. A guest could meet
 * two gates in one session and be asked to do two apparently different
 * things — "Make a profile" at Drop a pin, "Create an account" one tap later
 * on a pin's card — when both push the same /join. The gate's reasons are
 * about the profile ("Pins come with your name on them"), and "account" is
 * the word the business flow keeps for itself.
 */
const CTA = 'Make a profile';

export function SignUpGate({
  reason,
  where,
  compact = false,
  onNavigate = (go) => go(),
}: {
  reason: string;
  /**
   * A short, stable name for THIS gate, and the only thing analytics ever
   * sees. `reason` is a human sentence and one of them interpolates another
   * traveler's display name, so sending it would have exported a real
   * person's name to a third-party vendor from a signed-out screen. It also
   * makes the funnel legible: a reason edited for tone would otherwise split
   * one gate into two lines on the chart.
   */
  where: string;
  compact?: boolean;
  /**
   * How to run the jump to sign-up. A caller that renders this INSIDE a sheet
   * must pass `leavingSheet(close)`, or the sheet's scrim outlives the push
   * and freezes whatever is behind it. See components/ui/sheet.
   */
  onNavigate?: (go: () => void) => void;
}) {
  // Both halves of the only conversion step in the app: how often a gate is
  // put in front of somebody, and how often they take it. `where` is the
  // label, so the numbers say WHICH gate converts — never `reason`, which is
  // prose and sometimes carries somebody's name.
  useEffect(() => {
    analytics.capture('gate_shown', { where });
  }, [where]);

  return (
    <GlassSurface radius={Radius.xl} style={compact ? styles.compact : styles.card}>
      <View style={styles.inner}>
        <ThemedText type="headline">{reason}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Takes a minute. Always free.
        </ThemedText>
        <PrimaryButton
          label={CTA}
          onPress={() => {
            analytics.capture('gate_tapped', { where });
            onNavigate(() => router.push('/join'));
          }}
        />
        {/* The second door. A gate that offers only "make a profile" reads
            as "you are new", and the person who already has an account —
            reinstalling, or on somebody else's phone — has to guess that
            signing in is hidden one screen inside signing up. Both doors,
            at the moment the question is asked. */}
        <PrimaryButton
          variant="ghost"
          label="I already have an account"
          onPress={() => {
            analytics.capture('gate_signin_tapped', { where });
            onNavigate(() => router.push('/email'));
          }}
        />
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  // No horizontal margin of its own. Every caller already pads its own
  // column, so the gate's 16pt landed ON TOP of that and put its edges 16pt
  // inside the block directly above it — measurably, 40pt against 24pt on
  // Travelers and Chat, 32pt against 16pt inside the map's sheet. Two edges
  // that close together in one column read as a misplaced element rather
  // than as hierarchy.
  card: {},
  compact: {
    marginTop: Space.sm,
  },
  inner: {
    gap: Space.md,
    padding: Space.lg,
  },
});
