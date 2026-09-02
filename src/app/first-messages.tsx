import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import { MaxContentWidth, Space, Spacing } from '@/constants/theme';
import { useAnnounce } from '@/features/chat/use-announce';
import { useIncomingRequests } from '@/features/matching/hooks';
import { IncomingRequestCard } from '@/features/matching/incoming-request-card';
import { countOf } from '@/lib/plural';

/**
 * Every hello waiting on an answer, on a page of its own.
 *
 * The inbox keeps one or two of these inline, because one or two genuinely
 * belong there. Past that they stop being a list of decisions and become a
 * wall: eight full cards is 1600pt of judgement calls between a returning
 * traveler and the conversation they opened the app for. So the inbox
 * collapses them to a single row and they get this screen instead.
 *
 * The cards are the inbox's own card, not a second copy of it — accept,
 * decline, the undo window and the report line are written once
 * (features/matching/incoming-request-card).
 */
export default function FirstMessagesScreen() {
  const query = useIncomingRequests();
  const requests = query.data ?? [];

  useAnnounce(
    query.isSuccess
      ? requests.length > 0
        ? countOf(requests.length, 'first message')
        : 'Nothing waiting on you'
      : null
  );

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* The title is on the route (_layout: "Waiting on you"), in the
            header row the back chevron already had. The page used to write
            it again underneath, which put a whole row of chrome between the
            chevron and the first card. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          Answer one and the chat opens. Decline and they are never told.
        </ThemedText>
        {query.isPending ? (
          <>
            <ChatRowSkeleton />
            <ChatRowSkeleton />
          </>
        ) : null}
        {query.isError ? (
          <LoadError
            compact
            what="the first messages waiting on you"
            error={query.error}
            onRetry={query.refetch}
          />
        ) : null}
        <View style={styles.list}>
          {requests.map((request) => (
            <IncomingRequestCard key={request.id} request={request} />
          ))}
        </View>
        {/* Only on success-with-zero: a failed fetch is not an empty inbox. */}
        {query.isSuccess && requests.length === 0 ? (
          <EmptyState
            title="Nothing waiting on you"
            body="When somebody says hi, it lands here for you to answer."
          />
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    gap: Space.md,
    padding: Space.lg,
    paddingBottom: Spacing.six,
  },
  list: {
    gap: Space.md,
  },
});
