import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { loadFailureMessage } from '@/lib/failure-message';

/**
 * What a screen shows when its data did not arrive.
 *
 * This exists because every screen in the app used to answer a FAILED query
 * with its EMPTY state: a traveller offline was told they had no chats, no
 * travelers and no trips, and that a friend's invite link was dead. Saying
 * "nothing here" when the truth is "could not ask" is the wrong answer to the
 * commonest condition on the road, and it hides the one thing that helps,
 * which is trying again.
 *
 * `what` completes "… could not load", so pass a lowercase noun phrase:
 * "your chats", "this conversation", "the map".
 */
export function LoadError({
  what,
  error,
  onRetry,
  compact = false,
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.root, compact ? styles.compact : styles.full]}>
      <ThemedText type={compact ? 'footnote' : 'callout'} themeColor="textSecondary">
        {loadFailureMessage(error, what)}
      </ThemedText>
      <View style={compact ? styles.compactAction : styles.action}>
        <PrimaryButton variant="ghost" label="Try again" onPress={onRetry} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Space.md,
    alignItems: 'center',
  },
  full: {
    flex: 1,
    justifyContent: 'center',
    padding: Space.lg,
  },
  compact: {
    padding: Space.lg,
  },
  action: {
    alignSelf: 'stretch',
    maxWidth: 280,
  },
  compactAction: {
    alignSelf: 'stretch',
  },
});
