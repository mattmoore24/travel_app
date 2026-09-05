import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, MaxContentWidth, Spacing } from '@/constants/theme';
import { PRIVACY_PROMISE, PRIVACY_SECTIONS } from '@/constants/policies';
import { useTheme } from '@/hooks/use-theme';

/**
 * The privacy policy, readable before sign-up and from the profile tab
 * (App Review 5.1.1(i) wants it reachable in-app, not only on the store
 * listing). Bundled, never fetched: the person deciding whether to hand over
 * a face and an age reads it offline, before an account exists. Long-form
 * source of truth: docs/legal/PRIVACY_POLICY.md.
 */
export default function PrivacyScreen() {
  const theme = useTheme();

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="title">Privacy policy</ThemedText>
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" style={{ color: theme.tint }}>
              {PRIVACY_PROMISE}
            </ThemedText>
          </ThemedView>

          {PRIVACY_SECTIONS.map((section) => (
            <View key={section.title} style={styles.section}>
              <ThemedText type="smallBold">{section.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {section.body}
              </ThemedText>
            </View>
          ))}

          {/* Back the other way, so neither document is a dead end. */}
          <View style={styles.section}>
            <ThemedText type="smallBold">House rules</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              The short version of what is allowed here, and what happens when it is not.
            </ThemedText>
            <PrimaryButton
              variant="ghost"
              label="Read the house rules"
              onPress={() => router.push('/guidelines')}
            />
          </View>

          <View style={styles.section}>
            <ThemedText type="smallBold">Questions about your data?</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Big or small, we read every message.
            </ThemedText>
            <PrimaryButton
              variant="ghost"
              label="Send us a message"
              onPress={() => router.push('/contact')}
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
    borderRadius: Radius.lg,
  },
  section: {
    gap: Spacing.one,
  },
  footer: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
  },
});
