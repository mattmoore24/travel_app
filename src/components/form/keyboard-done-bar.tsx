import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The id every field that needs a visible way out points at.
 *
 * One id for the whole app rather than one per screen: an InputAccessoryView
 * is matched by nativeID at the moment a field takes focus, so a single bar
 * mounted in the shell serves every field under it.
 */
export const KEYBOARD_DONE_ID = 'keyboard-done';

/**
 * A "Done" row above the keyboard, for the keyboards that have no way out of
 * their own.
 *
 * Founder, 2026-08-24: "every time the keyboard is up to type for any
 * situation, there is always a button or clear way to dismiss the keyboard.
 * Sometimes I find myself done typing and it's not clear how to quickly make
 * the keyboard go away."
 *
 * The rule this implements, so the next screen does not have to be argued
 * about: a field whose return key already ends typing needs nothing here. A
 * field whose keyboard has NO usable return key does:
 *
 *   - `number-pad` and `phone-pad` draw no return key at all on iOS, so
 *     nothing on the keyboard can end typing. Setting returnKeyType on one is
 *     a no-op that reads like a fix.
 *   - `multiline` draws one, and it inserts a newline. That is correct for a
 *     bio, and it means the return key is not an exit.
 *
 * On both, the only remaining exits were a docked Continue (which commits and
 * moves on rather than putting the keyboard away) and dragging the scroll
 * view, which nothing on screen advertises.
 *
 * Lifted verbatim out of pin-form-sheet, which had the whole pattern working
 * for one multiline field and kept it to itself.
 *
 * Render it as a SIBLING of the scroll view, never inside one. It is not laid
 * out in the page: iOS hosts it in the keyboard's own window.
 *
 * iOS only. Android has a system back gesture that dismisses the keyboard and
 * no InputAccessoryView, so there is nothing to render and nothing missing.
 *
 * One deliberate holdout: pin-form-sheet keeps its own bar under its own
 * nativeID. It renders inside map-screen, which now mounts this one, and two
 * accessory views sharing a nativeID is undefined behaviour rather than a
 * tidy-up. Leave them distinct.
 */
export function KeyboardDoneBar() {
  const theme = useTheme();
  if (Platform.OS !== 'ios') {
    return null;
  }
  return (
    <InputAccessoryView nativeID={KEYBOARD_DONE_ID}>
      <View style={[styles.bar, { backgroundColor: theme.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Done editing"
          hitSlop={10}
          // Blurs whatever is focused without needing a ref to it.
          onPress={() => Keyboard.dismiss()}>
          <ThemedText type="smallBold" themeColor="accent">
            Done
          </ThemedText>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

/**
 * What a field passes to reach the bar. Undefined off iOS, where the bar does
 * not render, so a dangling id never points at nothing.
 */
export const keyboardDoneProps = {
  inputAccessoryViewID: Platform.OS === 'ios' ? KEYBOARD_DONE_ID : undefined,
} as const;

const styles = StyleSheet.create({
  bar: {
    alignItems: 'flex-end',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
});
