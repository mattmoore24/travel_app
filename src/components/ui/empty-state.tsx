import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';

/**
 * The one empty state, everywhere a list can be empty.
 *
 * Title, body, one named action — the shape every screen's nothing-here
 * moment shares, so two states of the same screen stop composing as if they
 * were designed by different people (the Chat tab centred its guest block in
 * the leftover space and jammed the signed-in card under the segmented
 * control; Travelers used two different top pads for its two walls).
 *
 * TOP-ANCHORED by design: the block starts where a populated list's first
 * row would, so switching between empty and full does not move the eye. The
 * screen supplies that offset — this component is the block, not the page.
 * Extra actions beyond the primary go in `children`, after it.
 */
export function EmptyState({
  title,
  body,
  action,
  children,
  style,
}: {
  title: string;
  body?: string;
  /** The one next action, rendered as the screen's PrimaryButton. */
  action?: { label: string; onPress: () => void };
  /** Secondary actions, below the primary (ghost buttons, gates). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.root, style]}>
      <ThemedText type="title" style={styles.centred}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText themeColor="textSecondary" style={styles.centred}>
          {body}
        </ThemedText>
      ) : null}
      {action ? <PrimaryButton label={action.label} onPress={action.onPress} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Space.md,
    alignItems: 'stretch',
  },
  centred: {
    textAlign: 'center',
  },
});
