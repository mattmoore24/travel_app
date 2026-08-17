import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useMyChats } from '@/features/matching/hooks';
import { useChatPref } from '@/features/rooms/hooks';

/**
 * Archived conversations stay fully readable forever (Hinge's model) — they
 * are out of the way, not gone. A new message un-archives automatically.
 */
export default function ArchivedChatsScreen() {
  const { data: chats = [] } = useMyChats(true);
  const pref = useChatPref();

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ThemedText type="title">Archived</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Still readable. A new message brings a conversation back to the top of your list.
        </ThemedText>
        {chats.map((chat) => (
          <Pressable
            key={chat.chat_id}
            onPress={() =>
              router.push(chat.kind === 'room' ? `/room/${chat.chat_id}` : `/chat/${chat.chat_id}`)
            }
            onLongPress={() => pref.mutate({ chatId: chat.chat_id, archived: false })}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundElement" style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText type="callout">{chat.title ?? 'Traveler'}</ThemedText>
                {chat.last_message ? (
                  <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
                    {chat.last_message}
                  </ThemedText>
                ) : null}
              </View>
            </ThemedView>
          </Pressable>
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
  pressed: {
    opacity: 0.7,
  },
});
