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

  // A button that is not AVAILABLE changes COLOUR. Nothing fades any more.
  //
  // `opacity: 0.4` dims a label and its ground together, so it cannot lower
  // one without lowering the other: the filled variant measured 2.35:1 that
  // way and the ghost and danger variants measured 2.28:1, all of them under
  // the 3:1 floor for a control, on pills that still looked tappable. The
  // fill swap fixed the first and left the other two, which is the half-fix
  // this removes. A grey label where an accent one belongs is what says
  // "not now", and it stays readable at 8.2:1 while it says it.
  //
  // Loading is deliberately NOT that state. A button that goes grey the
  // instant you press it reads as having broken rather than as working.
  const unavailable = Boolean(disabled) && !loading;
  const background =
    unavailable && (variant === 'filled' || variant === 'tonal')
      ? theme.surfaceSunken
      : variant === 'filled'
        ? theme.accent
        : variant === 'tonal'
          ? theme.accentSoft
          : 'transparent';
  const labelColor = unavailable
    ? theme.textSecondary
    : variant === 'filled'
      ? theme.onAccent
      : variant === 'danger'
        ? theme.danger
        : theme.accent;

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
        // No lift on a control you cannot press.
        variant === 'filled' && !unavailable && Elevation.raised,
        variant !== 'filled' && variant !== 'tonal' && styles.quiet,
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
});
