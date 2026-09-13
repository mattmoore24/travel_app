import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { AccessibilitySizesFrom, FontCap, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The one empty state, everywhere a list can be empty.
 *
 * Glyph, title, body, one named action, then any secondary actions: the
 * shape every screen's nothing-here moment shares, so two states of the
 * same screen stop composing as if they were designed by different people
 * (the Chat tab centred its guest block in the leftover space and jammed
 * the signed-in card under the segmented control; Travelers used two
 * different top pads for its two walls).
 *
 * TOP-ANCHORED by design: the block starts where a populated list's first
 * row would, so switching between empty and full does not move the eye. The
 * screen supplies that offset: this component is the block, not the page.
 * Extra actions beyond the primary go in `children`, and they always sit
 * directly under it, never split from it by a paragraph.
 *
 * AT THE ACCESSIBILITY SIZES (fontScale at or above AccessibilitySizesFrom)
 * the order changes to title, action, children, body, and the glyph is
 * dropped. Apple's content-unavailable order is image, text, secondary
 * text, button at every size, and this deliberately departs from it above
 * the line, because on every screen that uses EmptyState the title carries
 * the instruction ("No chats yet", "Nobody has dropped in yet", "Travelers
 * opens once you add a trip") and the action is what the reader came for;
 * below the action, the explanation wraps to most of a screen at AX5 and
 * pushed the button under the tab bar until the reader scrolled (E2E run
 * 142's follow-up). The glyph goes for the reason Apple's own Dynamic Type
 * guidance gives for dropping purely decorative views at the largest sizes:
 * a 56pt mark spends a tenth of the viewport and carries no information.
 * The children stay with the primary through the reorder because they are
 * the secondary actions by this component's own contract (the Travelers
 * wall passes a primary plus ghost buttons), and a paragraph between the
 * two would read as two unrelated blocks. VoiceOver order follows the
 * visual one: title, button, explanation.
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
  const { fontScale } = useWindowDimensions();
  // The category line, not a rounded guess: at and above it the block is
  // re-ordered and the glyph dropped, as the doc comment explains.
  const accessibilitySize = fontScale >= AccessibilitySizesFrom;

  const bodyText = body ? (
    <ThemedText themeColor="textSecondary" style={styles.centred}>
      {body}
    </ThemedText>
  ) : null;
  // The label is on tappable chrome, so it takes the theme's control cap at
  // EVERY size: an uncapped two-line 47pt button was eating the room the
  // reorder above reclaims, and the pill's own height is what the reader
  // taps, not the label's.
  const actions = (
    <>
      {action ? (
        <PrimaryButton
          label={action.label}
          onPress={action.onPress}
          maxFontSizeMultiplier={FontCap.control}
        />
      ) : null}
      {children}
    </>
  );

  return (
    <View style={[styles.root, style]}>
      {glyph && !accessibilitySize ? (
        <View style={styles.glyph}>
          <SymbolView name={glyph} size={56} tintColor={theme.textSecondary} />
        </View>
      ) : null}
      <ThemedText type="title" style={styles.centred}>
        {title}
      </ThemedText>
      {accessibilitySize ? (
        <>
          {actions}
          {bodyText}
        </>
      ) : (
        <>
          {bodyText}
          {actions}
        </>
      )}
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
