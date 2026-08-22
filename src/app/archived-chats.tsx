import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useMyChats } from '@/features/matching/hooks';
import { useChatPref } from '@/features/rooms/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';

/**
 * Archived conversations stay fully readable forever (Hinge's model) — they
 * are out of the way, not gone. A new message un-archives automatically.
 */
export default function ArchivedChatsScreen() {
  const { data: chats = [] } = useMyChats(true);
  const pref = useChatPref();
  const theme = useTheme();

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="title">Archived</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Still readable. A new message brings one back to the top.
        </ThemedText>
        {chats.map((chat) => (
          <ThemedView key={chat.chat_id} type="backgroundElement" style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={chat.title ?? 'Conversation'}
              onPress={() =>
                router.push(
                  chat.kind === 'room' ? `/room/${chat.chat_id}` : `/chat/${chat.chat_id}`
                )
              }
              style={({ pressed }) => [styles.rowText, pressed && styles.pressed]}>
              <ThemedText type="callout">{chat.title ?? 'Traveler'}</ThemedText>
              {chat.last_message ? (
                <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                  {chat.last_message}
                </ThemedText>
              ) : null}
            </Pressable>
            {/* Un-archiving used to be an unannounced long press on the row:
                the only way out of this screen was a gesture nothing on it
                mentioned. A button says so. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Put ${chat.title ?? 'this conversation'} back`}
              hitSlop={8}
              onPress={() => {
                haptics.light();
                pref.mutate({ chatId: chat.chat_id, archived: false });
              }}
              style={({ pressed }) => [
                styles.putBack,
                { borderColor: theme.hairline },
                pressed && styles.pressed,
              ]}>
              <ThemedText type="footnote" themeColor="accent">
                Put back
              </ThemedText>
            </Pressable>
          </ThemedView>
        ))}
        {chats.length === 0 ? (
          <ThemedText themeColor="textSecondary">Nothing archived.</ThemedText>
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.lg,
  },
  rowText: {
    flex: 1,
    gap: Space.xs,
  },
  putBack: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: {
    opacity: 0.7,
  },
});
