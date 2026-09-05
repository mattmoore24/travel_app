import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { GuidelinesBody } from '@/features/support/guidelines-body';

/**
 * The house rules + support contact, readable before sign-up and from the
 * profile tab (App Review 1.2 requires both for user-generated content).
 * 'House rules' is the one user-facing name for the rulebook (decision D32);
 * docs/legal/COMMUNITY_GUIDELINES.md keeps its filename for App Review.
 *
 * The body lives in features/support/guidelines-body because a suspended or
 * closed account never reaches this route: the root layout renders the gate
 * instead of the navigator, so the account gate mounts the same component
 * directly.
 */
export default function GuidelinesScreen() {
  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['bottom']}>
        <GuidelinesBody
          onContact={() => router.push('/contact')}
          onPrivacy={() => router.push('/privacy')}
        />
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
  footer: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
  },
});
