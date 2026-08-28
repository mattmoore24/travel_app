import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { FormTextField } from '@/components/form/form-text-field';
import { keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, Radius, Space } from '@/constants/theme';
import { useReportBusiness } from '@/features/business/hooks';
import { REPORT_REASONS } from '@/features/business/vocabulary';
import { useTheme } from '@/hooks/use-theme';
import type { BusinessReportReason } from '@/lib/database.types';

/** The column is `note text` with a 300 check. Hitting the cap beats an error. */
const NOTE_MAX = 300;

export default function ReportPlaceScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string; name?: string }>();
  const report = useReportBusiness();
  // Nothing preselected, same as reporting a person: a form that opens on an
  // answer is a form somebody in a hurry sends with that answer, and a queue
  // of mislabelled reports is a queue nobody can triage.
  const [reason, setReason] = useState<BusinessReportReason | null>(null);
  const [note, setNote] = useState('');
  const name = params.name?.trim();

  const submit = async () => {
    if (!params.id || reason == null) {
      return;
    }
    try {
      await report.mutateAsync({
        businessId: params.id,
        reason,
        note: note.trim() || undefined,
      });
      // The same confirmation either way, and deliberately so. The database
      // takes one report per account and silently ignores the second, so
      // "you have already reported this" is a sentence we could only say by
      // telling whoever is holding the phone what this account did before.
      Alert.alert(
        'Report sent',
        `It comes to us straight away and we take a look. ${name ?? 'The business'} never finds out who reported it.`,
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch {
      // Surfaced by the global mutation error alert.
    }
  };

  return (
    <StepScreen
      title="Report this business"
      subtitle="A real person reads every report."
      continueLabel="Send report"
      continueDisabled={reason == null}
      continueLoading={report.isPending}
      note={reason == null ? "Pick what's off first." : null}
      onClose={() => router.back()}
      onContinue={submit}>
      <ThemedText type="smallBold">
        {name ? `What's off with ${name}?` : "What's off with this business?"}
      </ThemedText>

      {/* Rows rather than chips: these labels are sentences, and five of them
          wrapped into a chip row is a shape nobody reads. */}
      {REPORT_REASONS.map((option) => {
        const active = option.value === reason;
        return (
          <PressableScale
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            haptic="selection"
            scaleTo={0.985}
            onPress={() => setReason(option.value)}
            style={[
              styles.row,
              { backgroundColor: active ? theme.accentSoft : theme.surfaceSunken },
            ]}>
            <View style={styles.rowText}>
              <ThemedText type="callout">{option.label}</ThemedText>
            </View>
            {active ? (
              <SymbolView
                name={{ ios: 'checkmark', android: 'check', web: 'check' }}
                size={16}
                tintColor={theme.accent}
              />
            ) : null}
          </PressableScale>
        );
      })}

      <FormTextField
        label="Details (optional)"
        multiline
        numberOfLines={4}
        maxLength={NOTE_MAX}
        style={styles.note}
        placeholder="Anything else worth knowing?"
        value={note}
        onChangeText={setNote}
        hint={`${note.length}/${NOTE_MAX}`}
        {...keyboardDoneProps}
      />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rowText: {
    flex: 1,
  },
  note: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
