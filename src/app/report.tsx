import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useReportUser } from '@/features/chat/hooks';
import type { ReportReason } from '@/lib/database.types';

const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'flirtation_or_sexual', label: 'Flirting / sexual' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam' },
  { value: 'fake_profile', label: 'Fake profile' },
  { value: 'safety_concern', label: 'Safety concern' },
  { value: 'other', label: 'Other' },
];

export default function ReportScreen() {
  const params = useLocalSearchParams<{ userId: string; context?: string }>();
  const report = useReportUser();
  const [reason, setReason] = useState<ReportReason>('flirtation_or_sexual');
  const [details, setDetails] = useState('');

  const submit = async () => {
    if (!params.userId) {
      return;
    }
    try {
      await report.mutateAsync({
        reportedUserId: params.userId,
        reason,
        details: details.trim() || null,
        context: params.context ?? 'profile',
      });
      Alert.alert(
        'Report received',
        'Thank you — a human reviews every report. Consider blocking them too.',
        [{ text: 'Done', onPress: () => router.back() }]
      );
    } catch {
      // Surfaced by the global mutation error alert.
    }
  };

  return (
    <StepScreen
      title="Report"
      subtitle="This is a platonic travel app — flirting is reportable here, not just harassment."
      continueLabel="Submit report"
      continueLoading={report.isPending}
      onContinue={submit}>
      <ThemedText type="smallBold">What happened?</ThemedText>
      <ChipRow options={REASON_OPTIONS} selected={[reason]} onToggle={(v) => setReason(v)} />
      <FormTextField
        label="Details (optional)"
        multiline
        numberOfLines={4}
        style={styles.details}
        placeholder="Anything that helps us act quickly."
        value={details}
        onChangeText={setDetails}
      />
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  details: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
