import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { ChipRow } from '@/components/form/chip-row';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useBlockUser, useReportUser } from '@/features/chat/hooks';
import type { ReportReason } from '@/lib/database.types';

const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'flirtation_or_sexual', label: 'Explicit or sexual' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'spam', label: 'Spam' },
  { value: 'fake_profile', label: 'Fake profile' },
  { value: 'safety_concern', label: 'Safety concern' },
  { value: 'other', label: 'Other' },
];

export default function ReportScreen() {
  const params = useLocalSearchParams<{ userId: string; context?: string }>();
  const report = useReportUser();
  // Nothing preselected. A form that opens on "Harassment" is a form that
  // will be submitted saying "Harassment" by anybody in a hurry, and a
  // moderation queue full of mislabelled reports is a queue nobody can
  // triage.
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const block = useBlockUser();

  const submit = async () => {
    if (!params.userId || reason == null) {
      return;
    }
    try {
      await report.mutateAsync({
        reportedUserId: params.userId,
        reason,
        details: details.trim() || null,
        context: params.context ?? 'profile',
      });
      // Blocking is offered as a BUTTON rather than mentioned in a sentence.
      // Somebody who has just reported a person is the likeliest person in
      // the app to want them gone, and "you can block them too" left them to
      // go and find out how.
      Alert.alert('Report received', 'Thanks. A real person reads every report.', [
        {
          text: 'Block them too',
          style: 'destructive',
          onPress: () => {
            block.mutate(params.userId);
            router.back();
          },
        },
        { text: 'Done', onPress: () => router.back() },
      ]);
    } catch {
      // Surfaced by the global mutation error alert.
    }
  };

  return (
    <StepScreen
      title="Report someone"
      subtitle="A real person reads every report."
      continueLabel="Send report"
      continueDisabled={reason == null}
      continueLoading={report.isPending}
      note={reason == null ? 'Pick what happened first.' : null}
      onContinue={submit}>
      <ThemedText type="smallBold">What happened?</ThemedText>
      <ChipRow
        options={REASON_OPTIONS}
        selected={reason ? [reason] : []}
        onToggle={(v) => setReason(v)}
      />
      <FormTextField
        label="Details (optional)"
        multiline
        numberOfLines={4}
        // Bounded: the column is text, but an unbounded box invites an essay
        // the queue then has to read, and a length limit somebody discovers
        // by hitting it is kinder than one they discover on submit.
        maxLength={DETAILS_MAX}
        style={styles.details}
        placeholder="Anything that helps us sort it out fast."
        value={details}
        onChangeText={setDetails}
        hint={`${details.length}/${DETAILS_MAX}`}
      />
    </StepScreen>
  );
}

const DETAILS_MAX = 600;

const styles = StyleSheet.create({
  details: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
