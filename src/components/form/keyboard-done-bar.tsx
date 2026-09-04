import { type ReactNode, useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * A "Hide keyboard" row above the keyboard, for every field in the app.
 *
 * Founder, 2026-08-24: "every time the keyboard is up to type for any
 * situation, there is always a button or clear way to dismiss the keyboard."
 * Founder, 2026-08-28: "every keypad in the app should be able to be closed
 * without pressing enter." Founder, 2026-09-04, with a screenshot of the bio
 * step, keyboard up, no bar: "I've said it many times but it still isn't
 * there. EVERY KEYBOARD MUST HAVE THE DISMISS KEYBOARD BUTTON."
 *
 * It was built three times and it was never on the phone, and the reason is
 * in React Native's own source rather than in any of the three attempts.
 *
 * THE OLD SHAPE: ONE BAR PER SCREEN, ONE ID FOR THE WHOLE APP. A single
 * `<InputAccessoryView nativeID="keyboard-done">` mounted in each shell, and
 * every field pointed at that id. That is the documented pattern, and it was
 * right under the old renderer, where the FIELD looked the bar up by id each
 * time it was mounted.
 *
 * Fabric inverted it. `RCTInputAccessoryComponentView.didMoveToWindow`
 * (react-native/React/Fabric/Mounting/ComponentViews/InputAccessory/
 * RCTInputAccessoryComponentView.mm) runs `RCTFindTextInputWithNativeId`
 * over the window ONCE, when the BAR enters the window, takes the first field
 * whose `inputAccessoryViewID` matches, and caches it: the guard is
 * `if (self.window && !_textInput)`, so it never looks again. The field side
 * never looks at all: `RCTTextInputComponentView.setDefaultInputAccessoryView`
 * returns early whenever an `inputAccessoryViewID` is set, on the assumption
 * that the bar has already bound to it. So under one shared bar:
 *
 *   - the bar bound to whichever field existed when the shell first mounted,
 *     and every field mounted after it (every later signup step, every field
 *     revealed by a tap) got nothing, and
 *   - a field that got nothing did not fall back to iOS's default toolbar
 *     either, because the id being set suppresses that too.
 *
 * Which is exactly the founder's screenshot: step 7, reached from step 6,
 * bar bound to step 6's field, gone with it.
 *
 * THE SHAPE NOW: ONE BAR PER FIELD, MOUNTED WITH IT, AHEAD OF IT. `useId`
 * gives each pair its own id, so the one-shot search can only ever find the
 * right field. The bar is rendered BEFORE the field in sibling order, and that
 * order is load-bearing: Fabric assembles a new subtree bottom-up
 * (Differentiator.cpp emits `createMutations`, then the children's
 * `downwardMutations`, then this level's `insertMutations`) and attaches it
 * whole, so `didMoveToWindow` cascades parent-first over a subtree that is
 * already complete. The bar's search therefore finds the field, and it binds
 * BEFORE the field's own `didMoveToWindow` fires `autoFocus` — so an
 * autofocused field shows the keyboard with the bar already on it. Put the
 * bar after the field and autofocus would raise a keyboard the bar had not
 * yet been attached to, and nothing calls `reloadInputViews` afterwards.
 *
 * `KeyboardDone` is the only public way to get one, and it is a render prop
 * so that neither half can be forgotten or reordered: it renders the bar,
 * then hands the field the matching id. `FormTextField` uses it internally;
 * a raw `TextInput` wraps itself in it. The test in __tests__ walks the tree
 * for both halves.
 *
 * iOS only. Android has a system back gesture that dismisses the keyboard and
 * no InputAccessoryView, so there is nothing to render and nothing missing.
 */

/** What a field passes to reach its bar. Empty off iOS, where no bar exists. */
export type KeyboardDoneProps = { inputAccessoryViewID?: string };

/**
 * Render the bar, then the field that reaches it.
 *
 *   <KeyboardDone>{(done) => <TextInput {...done} ... />}</KeyboardDone>
 *
 * A fragment, so the pair takes whatever layout the caller already had; the
 * bar itself is `position: absolute` and hidden in the page (iOS hosts its
 * content in the keyboard's own window), so it costs the row nothing.
 */
export function KeyboardDone({ children }: { children: (done: KeyboardDoneProps) => ReactNode }) {
  const id = useId();
  if (Platform.OS !== 'ios') {
    return <>{children({})}</>;
  }
  return (
    <>
      <KeyboardDoneBar nativeID={id} />
      {children({ inputAccessoryViewID: id })}
    </>
  );
}

/**
 * The bar itself. Not exported for general use: a bar with an id nothing
 * points at is the bug this file exists to end, and `KeyboardDone` is how a
 * bar and its field stay paired.
 */
function KeyboardDoneBar({ nativeID }: { nativeID: string }) {
  const theme = useTheme();
  return (
    <InputAccessoryView nativeID={nativeID}>
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

const styles = StyleSheet.create({
  bar: {
    alignItems: 'flex-end',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
});
