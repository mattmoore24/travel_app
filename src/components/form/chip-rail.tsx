import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Radius, Space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

type ChipRailProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  selected: T;
  onSelect: (value: T) => void;
  label?: string;
};

/**
 * One line of choices that scrolls sideways rather than wrapping onto three
 * rows. A wrapped grid of chips is fine on a full screen and ruinous in a
 * sheet that also has to hold a keyboard.
 */
export function ChipRail<T extends string>({
  options,
  selected,
  onSelect,
  label,
}: ChipRailProps<T>) {
  const theme = useTheme();
  // The label is drawn as well as spoken. It used to be accessibility-only,
  // which left the Today/Tomorrow chips floating with no heading at all.
  const rail = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      accessibilityLabel={label}
      contentContainerStyle={styles.row}>
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            haptic="selection"
            scaleTo={0.94}
            onPress={() => {
              haptics.selection();
              onSelect(option.value);
            }}
            style={[styles.chip, { backgroundColor: active ? theme.accent : theme.surfaceSunken }]}>
            <ThemedText type="footnote" style={active ? { color: theme.onAccent } : undefined}>
              {option.label}
            </ThemedText>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
  if (!label) {
    return rail;
  }
  return (
    <View style={styles.labelled}>
      <ThemedText type="smallBold">{label}</ThemedText>
      {rail}
    </View>
  );
}

const styles = StyleSheet.create({
  labelled: {
    gap: Space.xs,
  },
  row: {
    gap: Space.sm,
    paddingRight: Space.lg,
  },
  chip: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
  },
});
