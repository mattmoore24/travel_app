import { StyleSheet, TextInput, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type FormTextFieldProps = TextInputProps & {
  label?: string;
  error?: string | null;
  hint?: string;
};

export function FormTextField({ label, error, hint, style, ...rest }: FormTextFieldProps) {
  const theme = useTheme();

  return (
    <ThemedView style={styles.container}>
      {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
      <TextInput
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          {
            color: theme.text,
            backgroundColor: theme.backgroundElement,
            fontFamily: Fonts?.sans,
          },
          error != null && { borderWidth: 1, borderColor: theme.danger },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <ThemedText type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </ThemedView>
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
});
