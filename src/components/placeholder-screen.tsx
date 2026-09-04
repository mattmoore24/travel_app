import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PlaceholderScreenProps = {
  icon: SymbolViewProps['name'];
  /**
   * Dev-phase badge. Optional, because the two states a REAL user can reach -
   * a city list that came back empty, and the web fallback - were showing
   * them an internal note in a code font. Rendered only in a DEV bundle now:
   * "only dev states can reach it" was true for an EAS build (the flag is a
   * build-time check on inlined EXPO_PUBLIC_ vars) and false for this
   * project's real shipping path — an OTA bundle published by a workflow run
   * missing those secrets ships the flag false to every phone on the channel.
   */
  phase?: string;
  children?: ReactNode;
} & (
  | {
      /**
       * The backend keys are missing from THIS BUNDLE. One written sentence
       * instead of five per-screen .env instructions: what somebody on a
       * misbuilt channel sees must not be a support ticket addressed to a
       * developer. The real developer guidance stays beside the check, in
       * the console.warn at src/lib/supabase.ts.
       */
      configError: true;
      title?: undefined;
      description?: undefined;
    }
  | { configError?: false; title: string; description: string }
);

/**
 * Empty-state shell for screens whose real implementation lands in a later
 * phase (see docs/PRODUCT_BRIEF.md §5). Keeps the tab structure — and the
 * app's information architecture — in place from day one.
 */
export function PlaceholderScreen(props: PlaceholderScreenProps) {
  const theme = useTheme();
  const title = props.configError ? "Can't reach Samewhere" : props.title;
  const description = props.configError
    ? 'Something is wrong on our end. Try again in a few minutes.'
    : props.description;
  const phase = props.configError ? 'waiting on backend keys' : props.phase;

  return (
    <ThemedView style={styles.container}>
      {/* SafeAreaView's edges all default to 'additive', so it ALREADY adds
          the bottom inset — and on a tab screen that inset contains the tab
          bar (see hooks/use-tab-bar-inset). Adding the constant on top was
          the same 50pt of dead space the docks carried. */}
      <SafeAreaView style={styles.safeArea}>
        <SymbolView name={props.icon} size={56} tintColor={theme.textSecondary} />
        <ThemedText type="title" style={styles.centerText}>
          {title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          {description}
        </ThemedText>
        {/* The code badge is a developer's note and must not be able to
            render in a production bundle, whatever state the screen is in. */}
        {phase && __DEV__ ? (
          <ThemedView type="backgroundElement" style={styles.phaseBadge}>
            <ThemedText type="code">{phase}</ThemedText>
          </ThemedView>
        ) : null}
        {props.children}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    // The bar's own clearance comes from SafeAreaView's additive edges; this
    // is only the breathing room under the centred content.
    paddingBottom: Spacing.three,
    maxWidth: MaxContentWidth,
  },
  centerText: {
    textAlign: 'center',
  },
  phaseBadge: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
});
