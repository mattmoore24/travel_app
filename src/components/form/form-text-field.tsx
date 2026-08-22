import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, HitTarget, Spacing } from '@/constants/theme';
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
        <TextInput
          ref={inputRef}
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.input,
            {
              color: theme.text,
              backgroundColor: theme.backgroundElement,
              fontFamily: Fonts?.sans,
            },
            // Room for the eye, so a long password does not run underneath it.
            showToggle && styles.inputWithToggle,
            error != null && { borderWidth: 1, borderColor: theme.danger },
            style,
          ]}
          {...rest}
          secureTextEntry={rest.secureTextEntry === true && !revealed}
        />
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
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
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
