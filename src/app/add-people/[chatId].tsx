import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardDoneBar, keyboardDoneProps } from '@/components/form/keyboard-done-bar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Fonts, HitTarget, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { useAddToGroup, useGroupMembers, usePeopleYouKnow } from '@/features/groups/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { saveFailureMessage } from '@/lib/failure-message';
import type { KnownPersonRow } from '@/lib/database.types';

/**
 * Adding somebody to a group without leaving the app.
 *
 * The old way out of here was a link: copy it, leave for iMessage, find the
 * person's phone number, paste. For somebody you met in a hostel two hours
 * ago that is three things you do not have. This is the same act with none
 * of them — you have talked to this person inside Samewhere, so Samewhere
 * knows who they are.
 *
 * Who is listed is the server's decision (people_you_know): an active
 * one-to-one chat or an active traveler group, never a venue's open room and
 * never a guest. So this screen shows what it is given and does not filter.
 */
export default function AddPeopleScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const { data: people = [], isLoading } = usePeopleYouKnow(query);
  const { data: members = [] } = useGroupMembers(chatId ?? null);
  const add = useAddToGroup(chatId ?? null);
  // Who has been added this visit, so a row can say so without waiting for
  // the members list to come back around.
  const [added, setAdded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const alreadyIn = new Set(members.map((member) => member.user_id));

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView edges={['bottom']} style={styles.safe}>
        <View style={styles.header}>
          <ThemedText type="title">Add someone</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Anyone you have chatted with, one to one or in a group. They join straight away.
          </ThemedText>
        </View>

        {/* Opaque, never glass: a field inside a visual-effect view cannot be
            focused at all (see the traps skill). */}
        <View style={[styles.searchRow, { backgroundColor: theme.surfaceSunken }]}>
          <SymbolView
            name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
            size={16}
            tintColor={theme.textSecondary}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search by name"
            placeholderTextColor={theme.textSecondary}
            autoCorrect={false}
            autoCapitalize="words"
            clearButtonMode="while-editing"
            accessibilityLabel="Search people you know"
            testID="add-people-search"
            style={[styles.searchInput, { color: theme.text, fontFamily: Fonts?.sans }]}
            // A search field with no Return that dismisses is how a list ends
            // up hidden behind a keyboard with no way back.
            {...keyboardDoneProps}
          />
        </View>

        {error ? (
          <ThemedText type="footnote" themeColor="danger" style={styles.error}>
            {error}
          </ThemedText>
        ) : null}

        <FlatList
          data={people}
          keyExtractor={(item) => item.user_id}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            isLoading ? null : query.trim() ? (
              <EmptyState
                style={styles.empty}
                title="Nobody by that name"
                body="Only people you have chatted with show up here."
              />
            ) : (
              <EmptyState
                style={styles.empty}
                title="Nobody yet"
                body="People you chat with, one to one or in a group, show up here."
              />
            )
          }
          renderItem={({ item }) => (
            <PersonRow
              person={item}
              state={alreadyIn.has(item.user_id) || added.includes(item.user_id) ? 'in' : 'out'}
              busy={add.isPending}
              onAdd={() => {
                setError(null);
                add.mutate(item.user_id, {
                  onSuccess: () => {
                    haptics.success();
                    setAdded((previous) => [...previous, item.user_id]);
                  },
                  onError: (e) => setError(saveFailureMessage(e)),
                });
              }}
            />
          )}
        />

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
      </SafeAreaView>
      <KeyboardDoneBar />
    </ThemedView>
  );
}

function PersonRow({
  person,
  state,
  busy,
  onAdd,
}: {
  person: KnownPersonRow;
  state: 'in' | 'out';
  busy: boolean;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const { data: photoUrl } = usePhotoUrl(person.photo_path);
  const name = person.display_name ?? 'Traveler';
  const inGroup = state === 'in';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={inGroup ? `${name}, already in this group` : `Add ${name}`}
      accessibilityState={{ disabled: inGroup || busy }}
      haptic={inGroup ? 'none' : 'light'}
      scaleTo={inGroup ? 1 : 0.98}
      disabled={inGroup || busy}
      onPress={onAdd}
      style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: theme.surfaceSunken }]}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
        ) : (
          <ThemedText type="callout" themeColor="textSecondary">
            {name.slice(0, 1).toUpperCase()}
          </ThemedText>
        )}
      </View>
      <View style={styles.rowText}>
        <View style={styles.nameRow}>
          <ThemedText type="callout">{name}</ThemedText>
          {person.verified ? <VerifiedSeal size={13} name={person.display_name} /> : null}
        </View>
        <ThemedText type="footnote" themeColor="textSecondary">
          {/* How you know them, because two Anas is the normal case in a
              hostel and the answer to "which one" is where you met. */}
          {person.chatted ? 'You two have a chat' : 'In a group with you'}
        </ThemedText>
      </View>
      {inGroup ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          Already in
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
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Space.lg,
    gap: Space.md,
  },
  header: {
    paddingTop: Space.lg,
    gap: Space.xs,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: HitTarget,
    paddingHorizontal: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Space.sm,
  },
  list: {
    gap: Space.xs,
    paddingBottom: Space.lg,
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  empty: {
    paddingTop: Space.xl,
  },
  error: {
    textAlign: 'center',
  },
  done: {
    minHeight: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
