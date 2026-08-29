import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { HitTarget, MaxContentWidth, Space } from '@/constants/theme';
import { addToGroup } from '@/features/groups/api';
import { useMyChats } from '@/features/matching/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { saveFailureMessage } from '@/lib/failure-message';
import { useQueryClient } from '@tanstack/react-query';

/**
 * The other direction of adding: you are looking at a person and want them
 * in one of your groups. The add-people screen starts from the group and
 * searches for a person; this starts from the person and lists the groups.
 *
 * Only traveler groups are listed. my_chats sets my_role on exactly those —
 * a venue's open room has no groups row and no membership to grant — and a
 * venue room is not a thing anybody gets "added" to anyway.
 */
export default function AddToGroupScreen() {
  const { userId, name } = useLocalSearchParams<{ userId: string; name?: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { data: chats = [] } = useMyChats();
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const groups = chats.filter((chat) => chat.kind === 'room' && chat.my_role != null);
  const who = name?.trim() || 'them';

  const add = async (chatId: string) => {
    setError(null);
    setBusy(chatId);
    try {
      await addToGroup(chatId, userId!);
      haptics.success();
      setAdded((previous) => [...previous, chatId]);
      queryClient.invalidateQueries({ queryKey: ['group-members', chatId] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (e) {
      setError(saveFailureMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Add {who} to a group</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          They join straight away and can leave whenever they like.
        </ThemedText>
        {error ? (
          <ThemedText type="footnote" themeColor="danger">
            {error}
          </ThemedText>
        ) : null}
        {groups.length === 0 ? (
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            You are not in any groups yet. Start one from the Chat tab, or drop a plan anyone can
            join.
          </ThemedText>
        ) : null}
        {groups.map((group) => {
          const done = added.includes(group.chat_id);
          return (
            <PressableScale
              key={group.chat_id}
              accessibilityRole="button"
              accessibilityLabel={
                done ? `Added to ${group.title ?? 'group'}` : `Add to ${group.title ?? 'group'}`
              }
              accessibilityState={{ disabled: done || busy != null }}
              haptic={done ? 'none' : 'light'}
              scaleTo={done ? 1 : 0.98}
              disabled={done || busy != null}
              onPress={() => add(group.chat_id)}
              style={styles.row}>
              <View style={styles.rowText}>
                <ThemedText type="callout">{group.title ?? 'Group'}</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {group.member_count ?? 1} {group.member_count === 1 ? 'person' : 'people'}
                </ThemedText>
              </View>
              {done ? (
                <ThemedText type="footnote" themeColor="textSecondary">
                  Added
                </ThemedText>
              ) : (
                <SymbolView
                  name={{ ios: 'plus.circle.fill', android: 'add_circle', web: 'add_circle' }}
                  size={22}
                  tintColor={theme.accent}
                />
              )}
            </PressableScale>
          );
        })}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Done"
          haptic="light"
          scaleTo={0.98}
          onPress={() => router.back()}
          style={styles.done}>
          <ThemedText type="callout" themeColor="accent">
            Done
          </ThemedText>
        </PressableScale>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    padding: Space.lg,
    gap: Space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.sm,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  empty: {
    paddingTop: Space.lg,
  },
  done: {
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Space.md,
  },
});
