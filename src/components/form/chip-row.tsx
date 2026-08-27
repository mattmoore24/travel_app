import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

type ChipRowProps<T extends string> = {
  options: readonly { value: T; label: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
};

/** Wrapping row of selectable chips (languages, gender, platforms). */
export function ChipRow<T extends string>({ options, selected, onToggle }: ChipRowProps<T>) {
  const theme = useTheme();

  return (
    <View style={styles.row}>
      {options.map((option) => {
        const isSelected = selected.includes(option.value);
        return (
          <Pressable
            // 34pt of chip plus 5 a side is the 44 every control here buys.
            hitSlop={{ top: 5, bottom: 5 }}
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => {
              haptics.selection();
              onToggle(option.value);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: isSelected ? theme.tint : theme.backgroundElement,
              },
              pressed && styles.pressed,
            ]}>
            <ThemedText type="small" style={{ color: isSelected ? theme.onTint : theme.text }}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  pressed: {
    opacity: 0.75,
  },
});
