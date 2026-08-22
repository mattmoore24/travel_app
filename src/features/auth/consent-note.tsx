import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

/**
 * The line App Review 1.2 requires on any app carrying user content: people
 * have to agree to the content rules, and the rules have to be readable
 * before they do. It sits under the button that creates the account, which
 * is the moment the agreement is actually made.
 */
export function ConsentNote() {
  const theme = useTheme();
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.text}>
      By continuing you agree to our{' '}
      {/* The role is what makes this a child element VoiceOver can land on
          and activate. Without it the sentence reads as one block and the
          link is unreachable. */}
      <ThemedText
        type="small"
        accessibilityRole="link"
        style={{ color: theme.tint }}
        onPress={() => router.push('/guidelines')}>
        community guidelines
      </ThemedText>
      . Keep it casual and friendly.
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  text: {
    textAlign: 'center',
  },
});
