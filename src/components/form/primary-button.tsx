import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PrimaryButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  loading?: boolean;
  variant?: 'filled' | 'ghost' | 'danger';
};

export function PrimaryButton({
  label,
  loading = false,
  variant = 'filled',
  disabled,
  style: _style,
  ...rest
}: PrimaryButtonProps) {
  const theme = useTheme();
  const inactive = disabled || loading;

  const background =
    variant === 'filled' ? theme.tint : variant === 'danger' ? 'transparent' : 'transparent';
  const labelColor =
    variant === 'filled' ? theme.onTint : variant === 'danger' ? theme.danger : theme.tint;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background },
        variant !== 'filled' && styles.ghost,
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <ThemedText type="smallBold" style={{ color: labelColor }}>
          {label}
        </ThemedText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 50,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    alignSelf: 'stretch',
  },
  ghost: {
    minHeight: 44,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
});
