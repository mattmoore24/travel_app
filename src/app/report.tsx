import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet } from 'react-native';

import { ChipRail } from '@/components/form/chip-rail';
import { FormTextField } from '@/components/form/form-text-field';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { useBlockUser, useReportUser } from '@/features/chat/hooks';
import type { ReportReason } from '@/lib/database.types';

/**
 * What a reporter can say, in their words.
 *
 * THE ORDER IS THE TRIAGE ORDER. The two urgent reasons lead because the chip
 * row is read top to bottom by somebody who is upset, and because putting
 * "Somebody here is in danger" below "Spam" says something about how
 * seriously it is taken.
 *
 * Both were added because the app had no way to say either at all: the
 * privacy policy promised we remove underage accounts through a mechanism
 * that did not exist, and a traveler who had just been followed home had to
 * file it as "Other". Each is phrased as an observation rather than an
 * accusation, and neither suppresses anybody by itself: they sort the report
 * to the front of the review queue and wake the phone of whoever is on duty,
 * and a person decides (decision D34).
 */
export const REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: 'immediate_danger', label: 'Somebody here is in danger' },
  { value: 'underage', label: 'They are under 18' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'flirtation_or_sexual', label: 'Explicit or sexual' },
  { value: 'safety_concern', label: 'Safety concern' },
  { value: 'fake_profile', label: 'Fake profile' },
  { value: 'spam', label: 'Spam' },
  { value: 'other', label: 'Other' },
];

/**
 * Values the database accepts and this form deliberately does not offer,
 * each with the reason. A value that is in neither list is a value somebody
 * added to the enum and forgot to think about, which is exactly what
 * happened to 'impersonation'; the test in
 * src/app/__tests__/report-reasons.test.ts fails until it lands in one.
 */
export const REASON_NOT_OFFERED: Partial<Record<ReportReason, string>> = {
  impersonation:
    'Fake profile already covers it in a traveler\u2019s words, and two chips a ' +
    'reporter has to choose between is a queue full of mislabelled reports. ' +
    'The value itself is an orphan on public.report_reason: 20260827090000 ' +
    'added it for the business report path, and the path that shipped writes ' +
    'a DIFFERENT enum (public.business_report_reason, whose value is ' +
    '\u2018not_this_business\u2019) into a different table (business_reports, ' +
    'via report_business). Nothing writes this value to reports today.',
};

export default function ReportScreen() {
  // A report names a person, or a chat, or both. A group that has gone bad is
  // the case with no person in it: the problem is the room, and picking
  // somebody to blame would be a guess.
  const params = useLocalSearchParams<{ userId?: string; chatId?: string; context?: string }>();
  const aboutAChat = !params.userId && params.chatId != null;
  const report = useReportUser();
  // Nothing preselected. A form that opens on "Harassment" is a form that
  // will be submitted saying "Harassment" by anybody in a hurry, and a
  // moderation queue full of mislabelled reports is a queue nobody can
  // triage.
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const block = useBlockUser();

  const submit = async () => {
    if ((!params.userId && !params.chatId) || reason == null) {
      return;
    }
    try {
      await report.mutateAsync({
        reportedUserId: params.userId ?? null,
        reportedChatId: params.chatId ?? null,
        reason,
        details: details.trim() || null,
        context: params.context ?? 'profile',
      });
      if (aboutAChat) {
        // No "block them too": there is nobody to block when the subject is
        // the room. The promise is the same one, in the same words.
        Alert.alert(
          'Report received',
          'We look at it within a day. If we act, we never tell anyone who reported it. You will not hear back unless we need more from you.',
          [{ text: 'Done', onPress: () => router.back() }]
        );
        return;
      }
      // Blocking is offered as a BUTTON rather than mentioned in a sentence.
      // Somebody who has just reported a person is the likeliest person in
      // the app to want them gone, and "you can block them too" left them to
      // go and find out how.
      Alert.alert(
        'Report received',
        'We look at it within a day. If we act, we never tell them who reported it. You will not hear back unless we need more from you.',
        [
          {
            text: 'Block them too',
            style: 'destructive',
            onPress: () => {
              if (params.userId) {
                block.mutate(params.userId);
              }
              router.back();
            },
          },
          { text: 'Done', onPress: () => router.back() },
        ]
      );
    } catch {
      // Surfaced by the global mutation error alert.
    }
  };

  return (
    <StepScreen
      title={aboutAChat ? 'Report this group' : 'Report someone'}
      // The same anonymity promise the lower-stakes business report already
      // makes. Reporting a person is the report where being named back is the
      // fear, and the form that omitted the promise was this one.
      subtitle={
        aboutAChat
          ? 'A real person reads every report. Nobody in the group is told who reported it.'
          : 'A real person reads every report. They are never told who reported them.'
      }
      continueLabel="Send report"
      continueDisabled={reason == null}
      continueLoading={report.isPending}
      note={reason == null ? 'Pick what happened first.' : null}
      onContinue={submit}>
      <ThemedText type="smallBold">What happened?</ThemedText>
      <ChipRail wrap options={REASON_OPTIONS} selected={reason} onSelect={(v) => setReason(v)} />
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
