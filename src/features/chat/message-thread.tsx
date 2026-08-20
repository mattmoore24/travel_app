import { Image } from 'expo-image';
import { useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { MessageRow, ReactionSummaryRow } from '@/lib/database.types';

/** The six people actually use, in the order the muscle memory expects. */
export const QUICK_REACTIONS = ['❤️', '😂', '👍', '🔥', '😮', '🙏'];

/** Messages from the same person within this window read as one turn. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

const TIME = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en', { weekday: 'long', month: 'short', day: 'numeric' });

function dayLabel(iso: string) {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) {
    return 'Today';
  }
  if (sameDay(date, yesterday)) {
    return 'Yesterday';
  }
  return DAY.format(date);
}

function Reactions({
  rows,
  onToggle,
}: {
  rows: ReactionSummaryRow[];
  onToggle: (emoji: string, on: boolean) => void;
}) {
  const theme = useTheme();
  if (rows.length === 0) {
    return null;
  }
  return (
    <View style={styles.reactionRow}>
      {rows.map((row) => (
        <PressableScale
          key={row.emoji}
          accessibilityRole="button"
          accessibilityLabel={`${row.emoji} ${row.count}`}
          haptic="light"
          scaleTo={0.9}
          onPress={() => onToggle(row.emoji, !row.reacted_by_me)}
          style={[
            styles.reactionChip,
            {
              backgroundColor: theme.surface,
              borderColor: row.reacted_by_me ? theme.accent : theme.hairline,
            },
          ]}>
          <ThemedText type="footnote">{row.emoji}</ThemedText>
          {row.count > 1 ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {row.count}
            </ThemedText>
          ) : null}
        </PressableScale>
      ))}
    </View>
  );
}

function Bubble({
  message,
  mine,
  grouped,
  last,
  reactions,
  onToggleReaction,
  onLongPress,
}: {
  message: MessageRow;
  mine: boolean;
  /** Same sender as the message before it, close in time. */
  grouped: boolean;
  /** Last of its group — the one that gets the tail. */
  last: boolean;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (emoji: string, on: boolean) => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const { data: imageUrl } = useChatPhotoUrl(message.image_path);

  const tail = last ? Radius.xs : Radius.bubble;
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={styles.bubbleColumn}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={message.body ?? 'Photo'}
          haptic="none"
          scaleTo={0.98}
          delayLongPress={220}
          onLongPress={
            onLongPress
              ? () => {
                  haptics.soft();
                  onLongPress();
                }
              : undefined
          }
          style={[
            styles.bubble,
            {
              backgroundColor: mine ? theme.accent : theme.surfaceSunken,
              borderBottomRightRadius: mine ? tail : Radius.bubble,
              borderBottomLeftRadius: mine ? Radius.bubble : tail,
              marginTop: grouped ? 2 : Space.sm,
            },
          ]}>
          {message.image_path ? (
            imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="cover" />
            ) : (
              <ThemedText type="footnote" themeColor="textSecondary">
                Photo in review
              </ThemedText>
            )
          ) : null}
          {message.body ? (
            <ThemedText style={mine ? { color: theme.onAccent } : undefined}>
              {message.body}
            </ThemedText>
          ) : null}
          <ThemedText
            type="caption"
            style={[styles.time, { color: mine ? 'rgba(255,255,255,0.72)' : theme.textSecondary }]}>
            {TIME.format(new Date(message.created_at))}
          </ThemedText>
        </PressableScale>
        <Reactions rows={reactions} onToggle={onToggleReaction} />
      </View>
    </View>
  );
}

/**
 * The conversation itself, shaped like every messaging app people already
 * use: newest at the bottom, own messages on the right, consecutive
 * messages from one person grouped under a single tail, day separators, and
 * a long press to react (founder review — the old layout was a list of
 * detached cards).
 */
export function MessageThread({
  messages,
  ownUserId,
  reactions,
  onToggleReaction,
  footer,
}: {
  messages: MessageRow[];
  ownUserId: string | null;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (messageId: string, emoji: string, on: boolean) => void;
  /** Rendered above the oldest message (inverted list ⇒ list footer). */
  footer?: React.ReactElement | null;
}) {
  const theme = useTheme();
  const [picking, setPicking] = useState<string | null>(null);

  const byMessage = new Map<string, ReactionSummaryRow[]>();
  for (const row of reactions) {
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), row]);
  }

  return (
    <>
      <FlatList
        style={styles.flex}
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardDismissMode="interactive"
        renderItem={({ item, index }) => {
          // Inverted: "next" is visually above, "previous" is below.
          const older = messages[index + 1];
          const newer = messages[index - 1];
          const mine = item.sender_id === ownUserId;
          const grouped =
            older != null &&
            older.sender_id === item.sender_id &&
            new Date(item.created_at).getTime() - new Date(older.created_at).getTime() <
              GROUP_WINDOW_MS;
          const last =
            newer == null ||
            newer.sender_id !== item.sender_id ||
            new Date(newer.created_at).getTime() - new Date(item.created_at).getTime() >=
              GROUP_WINDOW_MS;
          // The opening message is carried on the chat row, not the messages
          // table, so there is no id for a reaction to hang off.
          const reactable = !item.id.startsWith('first:');
          const newDay =
            older == null ||
            new Date(older.created_at).toDateString() !== new Date(item.created_at).toDateString();

          // One wrapper, not two siblings: an inverted list flips the cell
          // itself, so a fragment's children come out bottom-to-top and the
          // separator would mark the boundary with the NEWER message. Inside
          // a single view, ordinary top-to-bottom layout applies again.
          return (
            <View>
              {newDay ? (
                <View style={styles.dayRow}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {dayLabel(item.created_at).toUpperCase()}
                  </ThemedText>
                </View>
              ) : null}
              <Bubble
                message={item}
                mine={mine}
                grouped={grouped && !newDay}
                last={last}
                reactions={byMessage.get(item.id) ?? []}
                onToggleReaction={(emoji, on) => onToggleReaction(item.id, emoji, on)}
                onLongPress={reactable ? () => setPicking(item.id) : undefined}
              />
            </View>
          );
        }}
        ListFooterComponent={footer}
      />

      {picking ? (
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(120)}
          style={styles.pickerBackdrop}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Close"
            haptic="none"
            scaleTo={1}
            onPress={() => setPicking(null)}
            containerStyle={StyleSheet.absoluteFill}
            style={StyleSheet.absoluteFill}
          />
          <Animated.View
            entering={ZoomIn.springify().damping(16)}
            style={[styles.picker, Elevation.floating, { backgroundColor: theme.surface }]}>
            {QUICK_REACTIONS.map((emoji) => {
              const existing = (byMessage.get(picking) ?? []).find((r) => r.emoji === emoji);
              return (
                <PressableScale
                  key={emoji}
                  accessibilityRole="button"
                  accessibilityLabel={emoji}
                  haptic="light"
                  scaleTo={0.85}
                  onPress={() => {
                    // Tapping one you already used takes it back rather than
                    // trying to add it twice (which the DB refuses).
                    onToggleReaction(picking, emoji, !existing?.reacted_by_me);
                    setPicking(null);
                  }}
                  style={[
                    styles.pickerItem,
                    existing?.reacted_by_me ? { backgroundColor: theme.accentSoft } : undefined,
                  ]}>
                  <ThemedText type="title">{emoji}</ThemedText>
                </PressableScale>
              );
            })}
          </Animated.View>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.md,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  rowMine: {
    justifyContent: 'flex-end',
  },
  rowTheirs: {
    justifyContent: 'flex-start',
  },
  bubbleColumn: {
    maxWidth: '80%',
  },
  bubble: {
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.bubble,
    borderCurve: 'continuous',
    gap: 2,
  },
  time: {
    alignSelf: 'flex-end',
    fontWeight: '400',
    letterSpacing: 0,
  },
  photo: {
    width: 220,
    height: 220,
    borderRadius: Radius.md,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: Space.xs,
    marginTop: -6,
    marginHorizontal: Space.sm,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  dayRow: {
    alignItems: 'center',
    paddingVertical: Space.md,
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  picker: {
    flexDirection: 'row',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.pill,
  },
  pickerItem: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
