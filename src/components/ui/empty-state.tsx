import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
 *
 * `glyph` is optional and rare. It earns its place on a whole TAB that is
 * empty, where words alone read as a screen that failed to load rather than a
 * screen with nothing in it yet; a section inside a populated screen does not
 * need one.
 */
export function EmptyState({
  title,
  body,
  glyph,
  action,
  children,
  style,
}: {
  title: string;
  body?: string;
  /** A quiet mark above the title, for a whole tab with nothing on it. */
  glyph?: SymbolViewProps['name'];
  /** The one next action, rendered as the screen's PrimaryButton. */
  action?: { label: string; onPress: () => void };
  /** Secondary actions, below the primary (ghost buttons, gates). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.root, style]}>
      {glyph ? (
        <View style={styles.glyph}>
          <SymbolView name={glyph} size={56} tintColor={theme.textSecondary} />
        </View>
      ) : null}
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
  /* Its own centring row: the block is alignItems 'stretch' so the title and
     body fill the width and centre their own text, and a glyph in that flow
     would sit hard against the left edge. */
  glyph: {
    alignItems: 'center',
  },
});
