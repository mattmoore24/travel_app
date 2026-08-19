import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { GUIDELINE_SECTIONS, SUPPORT_EMAIL, ZERO_TOLERANCE } from '@/constants/policies';
import { useTheme } from '@/hooks/use-theme';

/**
 * Community guidelines + support contact, readable before sign-up and from
 * the profile tab (App Review 1.2 requires both for user-generated content).
 */
export default function GuidelinesScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Community guidelines</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {ZERO_TOLERANCE}
            </ThemedText>
          </ThemedView>

          {GUIDELINE_SECTIONS.map((section) => (
            <View key={section.title} style={styles.section}>
              <ThemedText type="smallBold">{section.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {section.body}
              </ThemedText>
            </View>
          ))}

          <View style={styles.section}>
            <ThemedText type="smallBold">Contact us</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Questions, appeals, anything that feels off. We read every message.
            </ThemedText>
            <PrimaryButton
              variant="ghost"
              label={SUPPORT_EMAIL}
              onPress={() => {
                Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
              }}
            />
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <PrimaryButton label="Done" onPress={() => router.back()} />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    gap: Spacing.three,
    padding: Spacing.four,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  section: {
    gap: Spacing.one,
  },
  footer: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
  },
});
