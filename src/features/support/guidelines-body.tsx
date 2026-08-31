import { ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GUIDELINE_SECTIONS, ZERO_TOLERANCE } from '@/constants/policies';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The house rules, as a component rather than a screen.
 *
 * Extracted so the ONE person who most needs to read them can. A suspended or
 * closed account never reaches /guidelines: the root layout returns the gate
 * INSTEAD OF the navigator, so there is no stack to push onto and
 * router.push is a silent no-op. Everything here therefore takes callbacks
 * rather than calling the router, and renders with no navigator mounted.
 *
 * `onPrivacy` is optional for the same reason: from behind the gate there is
 * nowhere for it to go, so the block is simply not drawn there.
 */
export function GuidelinesBody({
  onContact,
  onPrivacy,
}: {
  onContact: () => void;
  onPrivacy?: () => void;
}) {
  const theme = useTheme();

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedText type="title">House rules</ThemedText>
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

      {/* The two documents point at each other, so a person who opened
          one is never told to go and find the other. */}
      {onPrivacy ? (
        <View style={styles.section}>
          <ThemedText type="smallBold">Privacy</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            What we collect, what we never collect, and what happens to your selfie.
          </ThemedText>
          <PrimaryButton variant="ghost" label="Privacy policy" onPress={onPrivacy} />
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold">Contact us</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Questions, appeals, anything that feels off. We read every message.
        </ThemedText>
        <PrimaryButton variant="ghost" label="Send us a message" onPress={onContact} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
});
