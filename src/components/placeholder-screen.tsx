import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useTheme } from '@/hooks/use-theme';

type PlaceholderScreenProps = {
  icon: SymbolViewProps['name'];
  title: string;
  /**
   * Dev-phase badge. Optional, because the two states a REAL user can reach -
   * a city list that came back empty, and the web fallback - were showing
   * them an internal note in a code font. Only the "waiting on backend keys"
   * screens still carry one, and those only render with no Supabase keys,
   * which never happens in a shipped bundle.
   */
  phase?: string;
  description: string;
  children?: ReactNode;
};

/**
 * Empty-state shell for screens whose real implementation lands in a later
 * phase (see docs/PRODUCT_BRIEF.md §5). Keeps the tab structure — and the
 * app's information architecture — in place from day one.
 */
export function PlaceholderScreen({
  icon,
  title,
  phase,
  description,
  children,
}: PlaceholderScreenProps) {
  const theme = useTheme();
  // Room for the tab bar, which grows with Dynamic Type on native.
  const tabBarInset = useTabBarInset();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safeArea, { paddingBottom: tabBarInset + Spacing.three }]}>
        <SymbolView name={icon} size={56} tintColor={theme.textSecondary} />
        <ThemedText type="title" style={styles.centerText}>
          {title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          {description}
        </ThemedText>
        {phase ? (
          <ThemedView type="backgroundElement" style={styles.phaseBadge}>
            <ThemedText type="code">{phase}</ThemedText>
          </ThemedView>
        ) : null}
        {children}
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
