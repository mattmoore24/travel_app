import { ActivityIndicator, StyleSheet, type PressableProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type PrimaryButtonProps = Omit<PressableProps, 'children'> & {
  label: string;
  loading?: boolean;
  /** `filled` is the one primary action per screen; everything else is quiet. */
  variant?: 'filled' | 'ghost' | 'danger' | 'tonal';
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
    variant === 'filled' ? theme.accent : variant === 'tonal' ? theme.accentSoft : 'transparent';
  const labelColor =
    variant === 'filled' ? theme.onAccent : variant === 'danger' ? theme.danger : theme.accent;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(inactive), busy: loading }}
      disabled={inactive}
      scaleTo={0.97}
      haptic={variant === 'filled' ? 'soft' : 'none'}
      containerStyle={styles.container}
      style={[
        styles.button,
        { backgroundColor: background },
        variant === 'filled' && Elevation.raised,
        variant !== 'filled' && variant !== 'tonal' && styles.quiet,
        inactive && styles.disabled,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={labelColor} />
      ) : (
        <ThemedText type="callout" style={[styles.label, { color: labelColor }]}>
          {label}
        </ThemedText>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: 'stretch',
  },
  button: {
    minHeight: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.xl,
    alignSelf: 'stretch',
  },
  quiet: {
    minHeight: HitTarget,
  },
  label: {
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.4,
  },
});
