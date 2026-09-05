import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { HitTarget, Radius, Space } from '@/constants/theme';
import {
  RADIUS_OPTIONS_KM,
  nearestRadiusOption,
  radiusDetail,
  radiusLabel,
  type RadiusKm,
} from '@/features/matching/radius';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

/**
 * The dial. Five rows, one lit, saved on the tap: the same radio-row shape
 * the audience picker uses, because it is the same kind of decision - who
 * the queue reaches - and a second vocabulary for it would be a second
 * thing to learn.
 *
 * A real Sheet, opened only from a tap on the Travelers tab, never from a
 * data event (the traps skill on the presentation iOS drops).
 */
export function RadiusSheet({
  value,
  saving,
  onChange,
  onClose,
}: {
  value: number;
  saving: boolean;
  onChange: (km: RadiusKm) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const active = nearestRadiusOption(value);
  return (
    <Sheet onClose={onClose}>
      <ThemedText type="headline">How far to look</ThemedText>
      <ThemedText type="body" themeColor="textSecondary">
        From the centre of each city on your trips. Their trip is what puts somebody here, never
        where anybody is right now.
      </ThemedText>
      <View style={styles.list}>
        {RADIUS_OPTIONS_KM.map((option) => {
          const lit = option === active;
          return (
            <PressableScale
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ selected: lit, disabled: saving }}
              accessibilityLabel={[radiusLabel(option), radiusDetail(option)]
                .filter(Boolean)
                .join('. ')}
              testID={`radius-${option}`}
              scaleTo={0.985}
              disabled={saving}
              onPress={() => {
                if (lit) {
                  return;
                }
                haptics.selection();
                onChange(option);
              }}
              // Colour says chosen, never opacity: fading a row dims its text
              // and its ground together and the contrast between them
              // collapses (the traps skill records the class of bug).
              style={[
                styles.row,
                { backgroundColor: lit ? theme.accentSoft : theme.surfaceSunken },
              ]}>
              <View style={styles.rowText}>
                <ThemedText type="smallBold">{radiusLabel(option)}</ThemedText>
                {radiusDetail(option) ? (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {radiusDetail(option)}
                  </ThemedText>
                ) : null}
              </View>
            </PressableScale>
          );
        })}
      </View>
      <PrimaryButton label="Done" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: Space.sm,
  },
  row: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    gap: 2,
  },
});
