import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PlaceholderScreenProps = {
  icon: SymbolViewProps['name'];
  title: string;
  phase: string;
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <SymbolView name={icon} size={56} tintColor={theme.textSecondary} />
        <ThemedText type="subtitle" style={styles.centerText}>
          {title}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.centerText}>
          {description}
        </ThemedText>
        <ThemedView type="backgroundElement" style={styles.phaseBadge}>
          <ThemedText type="code">{phase}</ThemedText>
        </ThemedView>
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
    paddingBottom: BottomTabInset + Spacing.three,
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
