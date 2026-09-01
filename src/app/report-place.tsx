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
import { isConductReason, REPORT_REASONS } from '@/features/business/vocabulary';
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
  // Two of the seven reasons are about how the people at the business behaved
  // rather than about whether the pin is right, and the screen says different
  // things for them: what to write in the box, and what a report can actually
  // do about it.
  const conduct = isConductReason(reason);

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
      // The same confirmation whether or not this report is the first one,
      // and deliberately so. The database takes one report per account and
      // silently ignores the second, so "you have already reported this" is a
      // sentence we could only say by telling whoever is holding the phone
      // what this account did before.
      //
      // It DOES change with the reason, and only in what it promises. The old
      // sentence promised anonymity and nothing else, which is the right
      // answer to "the pin is in the wrong spot" and much too small an answer
      // to "the guy on the door followed me out". Somebody who has just typed
      // that needs to know it can reach the listing itself. Said as what a
      // report CAN do, never as what this one will do: what happens to it is
      // between the queue and a person, and the reporter never hears it.
      Alert.alert(
        'Report sent',
        conduct
          ? `A real person reads it straight away, and a business can come off the map over this. ${name ?? 'The business'} never finds out who reported it.`
          : `It comes to us straight away and we take a look. ${name ?? 'The business'} never finds out who reported it.`,
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
      note={reason == null ? 'Pick a reason first.' : null}
      onClose={() => router.back()}
      onContinue={submit}>
      {/* "What's off" was written when all five reasons were map corrections.
          Two of them are now about people, and asking a woman what is "off"
          with the bar whose doorman followed her out is the wrong question in
          the wrong register. This one covers both without leaning either
          way. */}
      <ThemedText type="smallBold">
        {name ? `What's going on with ${name}?` : "What's going on with this business?"}
      </ThemedText>

      {/* Rows rather than chips: these labels are sentences, and seven of
          them wrapped into a chip row is a shape nobody reads. */}
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
        // The box is optional either way, but the two questions want
        // different things in it. A map correction needs a detail we might
        // have missed; a conduct report needs the account of what happened,
        // and that is the only part of this form a person can act on.
        placeholder={conduct ? 'What happened?' : 'Anything else worth knowing?'}
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
