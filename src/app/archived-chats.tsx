import { router } from 'expo-router';
import { useRef } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import { ChatRow, SwipeAction, rowStyles } from '@/features/chat/chat-row';
import { MaxContentWidth, Space, Spacing } from '@/constants/theme';
import { useMyChats } from '@/features/matching/hooks';
import { useChatPref } from '@/features/rooms/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { ChatListRow } from '@/lib/database.types';

/**
 * Archived conversations stay fully readable forever (Hinge's model) — they
 * are out of the way, not gone. A new message un-archives automatically.
 *
 * The rows are the inbox's own ChatRow, not a bespoke card: this screen was
 * the one conversation list that never got the redesign, and its floating
 * cards had lost the avatar, the timestamp, the unread dot and the room
 * distinction. Un-archiving uses the inbox's own affordance vocabulary too —
 * a right swipe and a long press — with a visible hint, since neither
 * gesture announces itself.
 */
function ArchivedRow({ chat, last }: { chat: ChatListRow; last: boolean }) {
  const theme = useTheme();
  const pref = useChatPref();
  const swipe = useRef<SwipeableMethods>(null);

  const putBack = () => {
    swipe.current?.close();
    haptics.light();
    pref.mutate({ chatId: chat.chat_id, archived: false });
  };

  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={rowStyles.swipeActions}>
          <SwipeAction
            label="Put back"
            icon={{
              ios: 'arrow.uturn.backward',
              android: 'settings_backup_restore',
              web: 'settings_backup_restore',
            }}
            tint={theme.accent}
            onTint={theme.onAccent}
            onPress={putBack}
          />
        </View>
      )}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={chat.title ?? 'Conversation'}
        accessibilityHint="Press and hold to put it back in your chats"
        scaleTo={0.995}
        onPress={() =>
          router.push(chat.kind === 'room' ? `/room/${chat.chat_id}` : `/chat/${chat.chat_id}`)
        }
        onLongPress={() =>
          Alert.alert(chat.title ?? 'Conversation', undefined, [
            { text: 'Put back', onPress: putBack },
            { text: 'Cancel', style: 'cancel' },
          ])
        }>
        <ChatRow chat={chat} last={last} />
      </PressableScale>
    </ReanimatedSwipeable>
  );
}

export default function ArchivedChatsScreen() {
  // The whole query, not just its data: destructuring the rows away is what
  // told a person with six archived conversations, offline, that they had
  // "Nothing archived." — for a chat archive, the most alarming possible
  // wrong answer.
  const query = useMyChats(true);
  const chats = query.data ?? [];

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="title">Archived</ThemedText>
        {/* No visible "swipe" anywhere: the word is banned vocabulary, and
            the inbox teaches the same gestures without it. Press-and-hold is
            the named way; the slide is a habit people arrive with. */}
        <ThemedText type="footnote" themeColor="textSecondary">
          Still readable. A new message brings one back to the top, or press and hold one to put it
          back yourself.
        </ThemedText>
        {/* The shape of the list, while the list is on its way — same reason
            as the inbox: a cold open must not flash the empty sentence over
            rows that are about to arrive. */}
        {query.isPending ? (
          <>
            <ChatRowSkeleton />
            <ChatRowSkeleton />
            <ChatRowSkeleton />
          </>
        ) : null}
        {query.isError ? (
          <LoadError
            compact
            what="your archived chats"
            error={query.error}
            onRetry={query.refetch}
          />
        ) : null}
        {/* This scroller pads Space.lg, not the inbox's Spacing.four, so it
            cancels ITS own gutter — rowStyles.list would overshoot by 8pt a
            side and the separators would run off the screen edge. */}
        <View style={styles.list}>
          {chats.map((chat, i) => (
            <ArchivedRow key={chat.chat_id} chat={chat} last={i === chats.length - 1} />
          ))}
        </View>
        {/* Only on success-with-zero: a failed fetch is not an empty archive. */}
        {query.isSuccess && chats.length === 0 ? (
          <EmptyState
            title="Nothing archived yet"
            body="Archive a chat and it lands here. Quiet chats join on their own after two weeks."
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
  /* Cancels this scroller's own Space.lg gutter so the rows and their
     separators run edge to edge, the same trick as rowStyles.list — with
     this screen's own padding, which is what the negative margin must
     match. */
  list: {
    marginHorizontal: -Space.lg,
  },
});
