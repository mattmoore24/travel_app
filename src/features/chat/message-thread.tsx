import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { FlatList, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, HitTarget, Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { separatorFor } from '@/features/chat/separators';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { MessageRow, ReactionSummaryRow } from '@/lib/database.types';

/** The six people actually use, in the order the muscle memory expects. */
export const QUICK_REACTIONS = ['❤️', '😂', '👍', '🔥', '😮', '🙏'];

/** Messages from the same person within this window read as one turn. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** Height of the emoji row, so it can be positioned before it lays out. */
const PILL_HEIGHT = 52;

/** Height of one row in the action card below a lifted message. */
const ACTION_HEIGHT = 44;

/** Breathing room between the lifted message and the things around it. */
const LIFT_GAP = 10;

type Rect = { x: number; y: number; width: number; height: number };

/** A message's box in the thread's own coordinates, plus what it is. */
type MenuTarget = Rect & {
  message: MessageRow;
  mine: boolean;
};

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

/**
 * The visuals of one bubble, with no press behaviour attached. Shared by the
 * thread and by the copy that floats above the scrim while its menu is open,
 * so the lifted message is the same object the user pressed rather than an
 * approximation of it.
 */
function BubbleBody({
  message,
  mine,
  tailed,
}: {
  message: MessageRow;
  mine: boolean;
  /** Last of its group: the corner that gets the tail. */
  tailed: boolean;
}) {
  const theme = useTheme();
  const { data: imageUrl } = useChatPhotoUrl(message.image_path);
  const tail = tailed ? Radius.xs : Radius.bubble;

  return (
    <View
      style={[
        styles.bubble,
        {
          backgroundColor: mine ? theme.accentDeep : theme.surfaceSunken,
          borderBottomRightRadius: mine ? tail : Radius.bubble,
          borderBottomLeftRadius: mine ? Radius.bubble : tail,
        },
      ]}>
      {message.image_path ? (
        imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="cover" />
        ) : (
          <ThemedText
            type="footnote"
            style={{ color: mine ? theme.onAccentDeep : theme.textSecondary }}>
            Photo in review
          </ThemedText>
        )
      ) : null}
      {message.body ? (
        <ThemedText style={mine ? { color: theme.onAccentDeep } : undefined}>
          {message.body}
        </ThemedText>
      ) : null}
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
  onOpenMenu,
}: {
  message: MessageRow;
  mine: boolean;
  /** Same sender as the message before it, close in time. */
  grouped: boolean;
  /** Last of its group — the one that gets the tail. */
  last: boolean;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (emoji: string, on: boolean) => void;
  onOpenMenu?: (rect: Rect) => void;
}) {
  const anchor = useRef<View>(null);

  return (
    <View
      style={[
        styles.bubbleRow,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: grouped ? 2 : Space.sm },
      ]}>
      <View style={styles.bubbleColumn}>
        {/* A plain view around the pressable, because the menu needs to know
            where on screen this bubble actually is and PressableScale keeps
            its animated inner view to itself. */}
        <View ref={anchor} collapsable={false}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={message.body ?? 'Photo'}
            accessibilityHint={onOpenMenu ? 'Press and hold to react' : undefined}
            haptic="none"
            scaleTo={0.98}
            delayLongPress={220}
            onLongPress={
              onOpenMenu
                ? () => {
                    anchor.current?.measureInWindow((x, y, width, height) => {
                      haptics.soft();
                      onOpenMenu({ x, y, width, height });
                    });
                  }
                : undefined
            }>
            <BubbleBody message={message} mine={mine} tailed={last} />
          </PressableScale>
        </View>
        <Reactions rows={reactions} onToggle={onToggleReaction} />
      </View>
    </View>
  );
}

/** "You unsent a message", rendered where the message used to be. */
function UnsentNote({ mine, otherName }: { mine: boolean; otherName?: string | null }) {
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, styles.unsentRow]}>
      <ThemedText type="caption" themeColor="textSecondary">
        {mine ? 'You unsent a message' : `${otherName ?? 'They'} unsent a message`}
      </ThemedText>
    </View>
  );
}

/**
 * The long-press menu, anchored to the message it belongs to.
 *
 * The founder's note was exact: the reaction picker used to be a slab in the
 * middle of the screen with no relationship to what was being reacted to.
 * This lifts the pressed bubble above a scrim, puts the emoji row directly
 * over it and the actions directly under it, and shifts the whole group when
 * a message near an edge would push either off screen.
 */
function MessageMenu({
  target,
  hostHeight,
  existingEmoji,
  onPick,
  onUnsend,
  onReport,
  onClose,
}: {
  target: MenuTarget;
  hostHeight: number;
  existingEmoji: string | null;
  onPick: (emoji: string) => void;
  onUnsend?: () => void;
  onReport?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const mine = target.mine;

  const actions: { label: string; run: () => void }[] = [];
  if (onUnsend) {
    actions.push({ label: 'Unsend', run: onUnsend });
  }
  if (onReport) {
    actions.push({ label: 'Report', run: onReport });
  }

  const top = target.y;
  const actionsHeight = actions.length * ACTION_HEIGHT + Space.xs * 2;

  // Keep the pill, the message and the actions on screen as one block.
  const wantedTop = top - LIFT_GAP - PILL_HEIGHT - Space.md;
  const wantedBottom = top + target.height + LIFT_GAP + actionsHeight + Space.md;
  let shift = 0;
  if (wantedBottom > hostHeight) {
    shift = hostHeight - wantedBottom;
  }
  if (wantedTop + shift < 0) {
    shift = -wantedTop;
  }

  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(100)}
      style={[styles.menuLayer, { backgroundColor: theme.scrim }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        haptic="none"
        scaleTo={1}
        onPress={onClose}
        containerStyle={StyleSheet.absoluteFill}
        style={StyleSheet.absoluteFill}
      />

      {/* The emoji row, directly above the message. */}
      <View
        style={[styles.menuSide, { top: top + shift - LIFT_GAP - PILL_HEIGHT }, sideOf(mine)]}
        pointerEvents="box-none">
        <Animated.View
          entering={FadeIn.duration(140)}
          style={[styles.pill, Elevation.floating, { backgroundColor: theme.surface }]}>
          {QUICK_REACTIONS.map((emoji) => (
            <PressableScale
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={emoji}
              haptic="light"
              scaleTo={0.85}
              onPress={() => onPick(emoji)}
              style={[
                styles.pillItem,
                existingEmoji === emoji ? { backgroundColor: theme.accentSoft } : undefined,
              ]}>
              <ThemedText type="title">{emoji}</ThemedText>
            </PressableScale>
          ))}
        </Animated.View>
      </View>

      {/* The message itself, lifted out of the dimmed thread. */}
      <View style={[styles.menuSide, { top: top + shift }, sideOf(mine)]} pointerEvents="none">
        <View style={styles.liftedWidth}>
          <BubbleBody message={target.message} mine={mine} tailed />
        </View>
      </View>

      {actions.length > 0 ? (
        <View
          style={[styles.menuSide, { top: top + shift + target.height + LIFT_GAP }, sideOf(mine)]}
          pointerEvents="box-none">
          <Animated.View
            entering={FadeIn.duration(160)}
            style={[styles.actionCard, Elevation.floating, { backgroundColor: theme.surface }]}>
            {actions.map((action, index) => (
              <PressableScale
                key={action.label}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                haptic="light"
                scaleTo={0.98}
                onPress={action.run}
                style={[
                  styles.action,
                  index > 0
                    ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline }
                    : null,
                ]}>
                <ThemedText style={{ color: theme.danger }}>{action.label}</ThemedText>
              </PressableScale>
            ))}
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
  );
}

function sideOf(mine: boolean) {
  return mine ? styles.alignEnd : styles.alignStart;
}

/**
 * The conversation itself, shaped like every messaging app people already
 * use: newest at the bottom, own messages on the right, consecutive messages
 * from one person grouped under a single tail, time stamps between clusters
 * rather than inside bubbles, and a long press that lifts the message and
 * puts the reactions right on top of it.
 */
export function MessageThread({
  messages,
  ownUserId,
  otherName,
  reactions,
  onToggleReaction,
  onUnsend,
  onReport,
  footer,
}: {
  messages: MessageRow[];
  ownUserId: string | null;
  /** Whose name goes on "X unsent a message". */
  otherName?: string | null;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (messageId: string, emoji: string, on: boolean) => void;
  onUnsend?: (messageId: string) => void;
  onReport?: (messageId: string) => void;
  /** Rendered above the oldest message (inverted list ⇒ list footer). */
  footer?: React.ReactElement | null;
}) {
  const host = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const [hostHeight, setHostHeight] = useState(0);
  const [menu, setMenu] = useState<MenuTarget | null>(null);

  const byMessage = new Map<string, ReactionSummaryRow[]>();
  for (const row of reactions) {
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), row]);
  }

  // The menu positions itself from window coordinates, which only mean
  // anything once it knows where this view starts.
  const onHostLayout = (event: LayoutChangeEvent) => {
    setHostHeight(event.nativeEvent.layout.height);
    host.current?.measureInWindow((x, y) => {
      origin.current = { x, y };
    });
  };

  const mineFor = (m: MessageRow) => m.sender_id === ownUserId;
  const myEmojiOn = (messageId: string) =>
    (byMessage.get(messageId) ?? []).find((r) => r.reacted_by_me)?.emoji ?? null;

  return (
    <View ref={host} onLayout={onHostLayout} style={styles.flex} collapsable={false}>
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
          const mine = mineFor(item);
          const unsent = item.unsent_at != null;
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
          const reactable = !item.id.startsWith('first:') && !unsent;
          const separator = separatorFor(item, older);

          // One wrapper, not two siblings: an inverted list flips the cell
          // itself, so a fragment's children come out bottom-to-top and the
          // separator would mark the boundary with the NEWER message. Inside
          // a single view, ordinary top-to-bottom layout applies again.
          return (
            <View>
              {separator ? (
                <View style={styles.separatorRow}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {separator}
                  </ThemedText>
                </View>
              ) : null}
              {unsent ? (
                <UnsentNote mine={mine} otherName={otherName} />
              ) : (
                <Bubble
                  message={item}
                  mine={mine}
                  grouped={grouped && separator == null}
                  last={last}
                  reactions={byMessage.get(item.id) ?? []}
                  onToggleReaction={(emoji, on) => onToggleReaction(item.id, emoji, on)}
                  onOpenMenu={
                    reactable
                      ? (rect) =>
                          setMenu({
                            ...rect,
                            x: rect.x - origin.current.x,
                            y: rect.y - origin.current.y,
                            message: item,
                            mine,
                          })
                      : undefined
                  }
                />
              )}
            </View>
          );
        }}
        ListFooterComponent={footer}
      />

      {menu ? (
        <MessageMenu
          target={menu}
          hostHeight={hostHeight}
          existingEmoji={myEmojiOn(menu.message.id)}
          onPick={(emoji) => {
            // Tapping the one you already used takes it back; tapping a
            // different one moves yours, since a person gets one reaction.
            const current = myEmojiOn(menu.message.id);
            onToggleReaction(menu.message.id, emoji, current !== emoji);
            setMenu(null);
          }}
          onUnsend={
            menu.mine && onUnsend
              ? () => {
                  const id = menu.message.id;
                  setMenu(null);
                  onUnsend(id);
                }
              : undefined
          }
          onReport={
            !menu.mine && onReport
              ? () => {
                  const id = menu.message.id;
                  setMenu(null);
                  onReport(id);
                }
              : undefined
          }
          onClose={() => setMenu(null)}
        />
      ) : null}
    </View>
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
    gap: Space.xs,
  },
  photo: {
    width: 220,
    height: 220,
    borderRadius: Radius.md,
  },
  unsentRow: {
    marginTop: Space.sm,
    paddingHorizontal: Space.sm,
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
  separatorRow: {
    alignItems: 'center',
    paddingTop: Space.lg,
    paddingBottom: Space.sm,
  },
  menuLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
  },
  menuSide: {
    position: 'absolute',
    left: Space.md,
    right: Space.md,
  },
  alignEnd: {
    alignItems: 'flex-end',
  },
  alignStart: {
    alignItems: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    gap: Space.xs,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
  },
  pillItem: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: HitTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liftedWidth: {
    maxWidth: '80%',
  },
  actionCard: {
    minWidth: 180,
    paddingVertical: Space.xs,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  action: {
    height: ACTION_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
});
