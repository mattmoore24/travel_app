import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { KeyboardDone } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { Type, Radius, Fonts, HitTarget, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FormTextFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
  /**
   * A handle on the input itself, so one field's Return key can move focus
   * to the next. Tapping from field to field with the keyboard already up is
   * not reliable on iOS, and this app has now been bitten by that twice.
   */
  inputRef?: React.Ref<TextInput>;
  /**
   * Show an eye button that reveals what has been typed. Only meaningful
   * alongside secureTextEntry, and it is what lets a password field be a
   * single field: people confirm a password by reading it back, not by
   * typing it twice into a box that hides both attempts.
   */
  revealToggle?: boolean;
};

export function FormTextField({
  label,
  error,
  hint,
  style,
  inputRef,
  revealToggle = false,
  ...rest
}: FormTextFieldProps) {
  const theme = useTheme();
  const [revealed, setRevealed] = useState(false);
  const showToggle = revealToggle && rest.secureTextEntry === true;

  // A plain View, so the field paints no ground colour of its own. The
  // themed wrapper it used to have painted `background` (the page), which
  // matched the full-screen forms by luck and drew a near-black band behind
  // every label once these fields went into a sheet, whose ground is
  // `surface`.
  return (
    <View style={styles.container}>
      {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
      <View>
        {/* Every field gets its own Hide keyboard bar, rendered ahead of it.
            Founder, three times over: "every keypad in the app should be able
            to be closed without pressing enter". The bar used to be one per
            screen with one id for the whole app, and under Fabric that binds
            to a single field once and never again, which is why it was never
            on the phone; keyboard-done-bar.tsx has the whole story. */}
        <KeyboardDone>
          {(done) => (
            <TextInput
              ref={inputRef}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  color: theme.text,
                  backgroundColor: theme.backgroundElement,
                  fontFamily: Fonts?.sans,
                  // A visible edge, from the token that exists for exactly this:
                  // theme.ts calls `border` "input outlines and anything whose
                  // edge a user must see — 3.4:1". The field's fill measures
                  // 1.24:1 against the page, so without a stroke the boundary of
                  // every text box in the app was below the 3:1 floor for a
                  // control edge and simply not visible in bright light.
                  borderWidth: 1,
                  borderColor: theme.border,
                },
                // Room for the eye, so a long password does not run underneath it.
                showToggle && styles.inputWithToggle,
                error != null && { borderColor: theme.danger },
                style,
              ]}
              {...done}
              {...rest}
              secureTextEntry={rest.secureTextEntry === true && !revealed}
            />
          )}
        </KeyboardDone>
        {showToggle ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            hitSlop={6}
            onPress={() => setRevealed((on) => !on)}
            style={styles.reveal}>
            <SymbolView
              name={
                revealed
                  ? { ios: 'eye.slash', android: 'visibility_off', web: 'visibility_off' }
                  : { ios: 'eye', android: 'visibility', web: 'visibility' }
              }
              size={18}
              tintColor={theme.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    alignSelf: 'stretch',
  },
  input: {
    minHeight: 48,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: Type.body.fontSize,
  },
  inputWithToggle: {
    paddingRight: HitTarget,
  },
  reveal: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
