import { useState } from 'react';
import { Keyboard, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

export type SelectOption<T extends string> = { value: T; label: string };

type SelectFieldProps<T extends string> = {
  label?: string;
  placeholder?: string;
  options: readonly SelectOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  /** Shown under the field; keep it out unless it genuinely helps. */
  hint?: string;
  testID?: string;
};

/**
 * A dropdown that opens the app's own sheet rather than a wheel picker: the
 * wheel is a poor fit for short lists and looks nothing like the rest of the
 * app, while a sheet of real rows is thumb-friendly and reads as one system
 * with every other sheet here (docs/DESIGN.md).
 */
export function SelectField<T extends string>({
  label,
  placeholder = 'Select',
  options,
  value,
  onChange,
  hint,
  testID,
}: SelectFieldProps<T>) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <View style={styles.container}>
      {label ? <ThemedText type="callout">{label}</ThemedText> : null}
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        haptic="soft"
        scaleTo={0.985}
        // Put the keyboard away FIRST. A sheet is a native <Modal>, and
        // presenting one does not resign the first responder: with the Age
        // field's number pad still up, this sheet's options rendered
        // underneath it and the person saw a header, a scrim and no rows.
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        containerStyle={styles.fieldContainer}
        style={[styles.field, { backgroundColor: theme.surfaceSunken }]}>
        <ThemedText themeColor={selected ? 'text' : 'textSecondary'} style={styles.value}>
          {selected?.label ?? placeholder}
        </ThemedText>
        <SymbolView
          name={{ ios: 'chevron.up.chevron.down', android: 'expand_more', web: 'expand_more' }}
          size={14}
          tintColor={theme.textSecondary}
        />
      </PressableScale>
      {hint ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}

      {open ? (
        // `scrolls`: a long option list gives way and scrolls instead of
        // running its tail off the bottom of the screen.
        <Sheet scrolls onClose={() => setOpen(false)}>
          {label ? <ThemedText type="headline">{label}</ThemedText> : null}
          <View style={styles.options}>
            {options.map((option, i) => {
              const isSelected = option.value === value;
              return (
                <Animated.View key={option.value} entering={FadeIn.delay(i * 20).duration(160)}>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    haptic="none"
                    scaleTo={0.985}
                    onPress={() => {
                      haptics.selection();
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={[
                      styles.option,
                      { backgroundColor: isSelected ? theme.accentSoft : 'transparent' },
                    ]}>
                    <ThemedText style={styles.optionLabel}>{option.label}</ThemedText>
                    {isSelected ? (
                      <SymbolView
                        name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                        size={16}
                        tintColor={theme.accent}
                      />
                    ) : null}
                  </PressableScale>
                </Animated.View>
              );
            })}
          </View>
        </Sheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Space.sm,
    alignSelf: 'stretch',
  },
  fieldContainer: {
    alignSelf: 'stretch',
  },
  field: {
    minHeight: HitTarget + 6,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
  value: {
    flex: 1,
  },
  options: {
    gap: Space.xs,
  },
  option: {
    minHeight: HitTarget + 6,
    borderRadius: Radius.md,
    paddingHorizontal: Space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionLabel: {
    flex: 1,
  },
});
