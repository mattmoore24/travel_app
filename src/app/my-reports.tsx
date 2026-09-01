import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { REASON_OPTIONS } from '@/app/report';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import { Skeleton } from '@/components/ui/skeleton';
import { Radius, Space } from '@/constants/theme';
import { REPORT_REASONS } from '@/features/business/vocabulary';
import { useOwnUserId } from '@/features/profile/hooks';
import type { ReportState } from '@/features/support/api';
import { useMyReports, useMySupportMessages } from '@/features/support/hooks';
import { useTheme } from '@/hooks/use-theme';
import { dates } from '@/lib/locale';

/**
 * What became of the reports and messages you sent.
 *
 * A report used to end in a thank-you and vanish. There was no record of it
 * anywhere a person could look, so somebody who reported a stranger and heard
 * nothing concluded the app does not moderate - which is a review, and a
 * fair one, because from where they were standing it was indistinguishable
 * from true.
 *
 * WHAT THIS PAGE MAY SAY, and it is the whole design of it: your report, when
 * you filed it, what you said it was about, and whether a person has read it.
 * Nothing about the account you reported, in either direction. The database
 * enforces that rather than this screen - `my_report_status()` collapses
 * every resolved report to one word, so a ban and a dismissal arrive here
 * identical and there is no version of this file that could tell them apart
 * (20260902250000, and the pgTAP suite asserts the negative).
 *
 * The queries themselves live in features/support, beside the one that sends
 * a message to support in the first place, so this file is a screen and
 * nothing else.
 */

/**
 * The reporter's own words back, so a row is recognisable as the thing they
 * filed.
 *
 * BOTH report forms, in one lookup. A report about a person and a report
 * about a business are two enums in two tables, and the screen that only knew
 * about the first told somebody who reported a bar for a safety concern that
 * they had never sent anything. The two value sets have nothing in common, so
 * one flat map is unambiguous; building it from the forms' own lists means
 * the words here are the words the reporter was shown when they filed it.
 * Anything neither form offers (see REASON_NOT_OFFERED) is a value nothing
 * writes today and gets the neutral noun rather than a raw enum.
 */
const REASON_LABEL: Record<string, string> = Object.fromEntries(
  [...REASON_OPTIONS, ...REPORT_REASONS].map((option) => [option.value, option.label])
);

const STATE_LABEL: Record<ReportState, string> = {
  received: 'Received',
  reviewed: 'Reviewed',
};

const CATEGORY_LABEL: Record<string, string> = {
  safety: 'Safety',
  account: 'Account',
  other: 'Something else',
};

/**
 * One line of history: what it was, when, and where it got to.
 *
 * Not a Pressable. There is nowhere for it to go - the report is filed, the
 * message is sent - and the founder's own rule is that a row opening nothing
 * is worse than no row. Read as one accessibility element so a screen reader
 * gets the sentence rather than three fragments in an order it chose.
 */
function HistoryRow({
  title,
  when,
  state,
  first,
}: {
  title: string;
  when: string;
  state: string;
  first: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${title}, ${when}, ${state}`}
      style={[
        styles.row,
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline },
      ]}>
      <View style={styles.flex}>
        <ThemedText numberOfLines={2}>{title}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {when}
        </ThemedText>
      </View>
      <ThemedText type="footnote" themeColor="textSecondary">
        {state}
      </ThemedText>
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={[styles.card, { backgroundColor: theme.surface }]}>{children}</View>;
}

export default function MyReportsScreen() {
  // A guest has neither: reports are filed under an account and a guest's
  // message to support is written with no author at all, which is why the
  // database returns nothing for one. The row that opens this screen is only
  // drawn for an account, and the queries stay off regardless.
  const userId = useOwnUserId();
  // The whole query, not its rows. Destructuring the data away is what once
  // told somebody with six archived conversations, offline, that they had
  // none, and a history of reports is the same shape of wrong answer.
  const reports = useMyReports();
  const messages = useMySupportMessages();

  const day = dates().monthDayYear;
  const reportRows = reports.data ?? [];
  const messageRows = messages.data ?? [];
  // A disabled query sits at `isPending` forever, so the signed-in test has
  // to be part of the answer or a guest who reached this route somehow would
  // watch two skeletons pulse until they gave up.
  const pending = userId != null && (reports.isPending || messages.isPending);
  // Only on success-with-zero. A failed fetch is not an empty history, and
  // "you have never reported anybody" is a bad thing to tell somebody whose
  // report is sitting in the queue behind a dropped connection.
  const empty =
    userId == null ||
    (reports.isSuccess &&
      messages.isSuccess &&
      reportRows.length === 0 &&
      messageRows.length === 0);

  return (
    <StepScreen
      title="Your reports and messages"
      subtitle="Everything you have sent us, and where each one got to."
      continueLabel="Done"
      onContinue={() => (router.canGoBack() ? router.back() : router.replace('/profile-me'))}>
      {pending ? (
        <>
          <Skeleton height={72} radius={Radius.md} />
          <Skeleton height={72} radius={Radius.md} />
        </>
      ) : null}

      {reports.isError ? (
        <LoadError compact what="your reports" error={reports.error} onRetry={reports.refetch} />
      ) : null}

      {reportRows.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
            Reports you sent
          </ThemedText>
          <Card>
            {reportRows.map((report, index) => (
              <HistoryRow
                key={report.id}
                title={REASON_LABEL[report.reason] ?? 'A report'}
                when={day.format(new Date(report.created_at))}
                state={STATE_LABEL[report.state]}
                first={index === 0}
              />
            ))}
          </Card>
          {/* The sentence this whole screen is built around, said out loud
              rather than left to be inferred from a missing column. Somebody
              who reported a stranger will wonder what happened to them, and
              the honest answer is that we are never going to say - not that
              the answer is hiding one tap further in. */}
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.note}>
            Reviewed means a person read it. We never say what happened to somebody else&apos;s
            account, either way, and we never tell them who reported it.
          </ThemedText>
        </View>
      ) : null}

      {messages.isError ? (
        <LoadError compact what="your messages" error={messages.error} onRetry={messages.refetch} />
      ) : null}

      {messageRows.length > 0 ? (
        <View style={styles.section}>
          <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionTitle}>
            Messages to us
          </ThemedText>
          <Card>
            {messageRows.map((message, index) => (
              <HistoryRow
                key={message.id}
                title={
                  (message.category ? CATEGORY_LABEL[message.category] : null) ?? 'Your message'
                }
                when={day.format(new Date(message.created_at))}
                // Both true, and neither alarming. The row is the record from
                // the second it is written; delivery is our notification
                // catching up with it, so an undelivered message is not a
                // lost one and must not be drawn as a failure.
                state={message.delivered ? 'Delivered' : 'Sent'}
                first={index === 0}
              />
            ))}
          </Card>
        </View>
      ) : null}

      {empty ? (
        <EmptyState
          title="Nothing sent yet"
          body="Report somebody from their profile or a chat, or write to us from your account page, and it lands here."
        />
      ) : null}
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  section: {
    gap: Space.xs,
  },
  sectionTitle: {
    paddingHorizontal: Space.sm,
  },
  card: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 56,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  note: {
    paddingHorizontal: Space.sm,
    paddingTop: Space.xs,
  },
});
