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
 * The rule this implements, and it is now the simple one: EVERY field can
 * reach it. `FormTextField` points at this bar by default, so a screen gets
 * the behaviour by using the app's own field rather than by remembering.
 *
 * It used to be a judgement per field - a keyboard whose return key already
 * ended typing was deemed to have an exit, and only `number-pad`,
 * `phone-pad` and `multiline` got a bar. The founder disagreed twice, and
 * they were right: Return is not "put the keyboard away". It submits the
 * form, or it jumps to the next field. Somebody who has simply finished
 * typing and wants to see the screen again has neither of those in mind, and
 * on a screen with a docked Continue the only other exit was dragging the
 * scroll view, which nothing advertises.
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
 * Mount one wherever a field can be focused: the two step shells, the map,
 * `Sheet`, and the three screens that draw their own layout (a chat, a room,
 * a group's settings). Mounting it twice in one window is harmless — both
 * bars are this same bar — but a screen with none leaves its fields pointing
 * at nothing.
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
          accessibilityLabel="Hide keyboard"
          hitSlop={10}
          // Blurs whatever is focused without needing a ref to it.
          onPress={() => Keyboard.dismiss()}>
          {/* Not "Done": that word is reserved for controls that commit
              (StepScreen's continueLabel), and this bar only puts the
              keyboard away. */}
          <ThemedText type="smallBold" themeColor="accent">
            Hide keyboard
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
