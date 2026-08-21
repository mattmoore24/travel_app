import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  useWindowDimensions,
} from 'react-native';
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

/** Smallest height of one row in the action card below a lifted message. */
const ACTION_HEIGHT = 44;

/**
 * How far the action labels are allowed to grow with Dynamic Type. Uncapped,
 * "Unsend" and "Report" outrun a card whose position is computed before they
 * are laid out; capped, the card can be placed correctly and the words still
 * scale most of the way.
 */
const ACTION_SCALE_CAP = 1.4;

/** Stand-in bubble height before a measurement arrives. */
const UNMEASURED_HEIGHT = 80;

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
  onOpenMenu?: (rect: Rect | null) => void;
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
                    haptics.soft();
                    // Open FIRST, then refine. This used to happen only
                    // inside measureInWindow's callback, which made the whole
                    // interaction a silent no-op whenever that callback did
                    // not arrive — the press did nothing at all, with no way
                    // to tell that from a press that never registered. A long
                    // press must always produce a menu; where it sits is a
                    // detail the measurement improves a frame later.
                    onOpenMenu(null);
                    anchor.current?.measureInWindow((x, y, width, height) => {
                      if (width > 0 && height > 0) {
                        onOpenMenu({ x, y, width, height });
                      }
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

  const { fontScale } = useWindowDimensions();
  const top = target.y;
  // Scaled by the reader's own type size. The rows grow with it (minHeight,
  // not height — Unsend and Report were being clipped at larger settings),
  // and this estimate has to grow with them or the shift below would push
  // the card off the bottom of the screen instead of keeping it on.
  const rowHeight = ACTION_HEIGHT * Math.min(Math.max(fontScale, 1), ACTION_SCALE_CAP);
  const actionsHeight = actions.length * rowHeight + Space.xs * 2;

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
                <ThemedText
                  maxFontSizeMultiplier={ACTION_SCALE_CAP}
                  style={{ color: theme.danger }}>
                  {action.label}
                </ThemedText>
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
  authorFor,
  noteFor,
  canReact = true,
  emptyState,
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
  /**
   * Who sent this, when that is not obvious. A one-to-one chat has exactly
   * two people and needs no labels; a group has to say. Returns the name to
   * print above the first bubble of somebody's run, or null for no label.
   */
  authorFor?: (message: MessageRow) => string | null;
  /**
   * A line to print in place of the bubble — "Message removed by the host".
   * Unsending already works this way internally; this opens the same slot to
   * a caller whose messages can be taken down by somebody else.
   */
  noteFor?: (message: MessageRow) => string | null;
  /** False for somebody reading a room they have not joined. */
  canReact?: boolean;
  /** Shown when there are no messages at all. */
  emptyState?: React.ReactElement | null;
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
          const note = noteFor?.(item) ?? null;
          const reactable = canReact && !item.id.startsWith('first:') && !unsent && note == null;
          const separator = separatorFor(item, older);
          // Only above the first bubble of a run, and never above your own:
          // repeating a name on every bubble is what makes a group thread
          // unreadable.
          const author = !mine && !grouped ? (authorFor?.(item) ?? null) : null;

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
              {author ? (
                <ThemedText type="caption" themeColor="textSecondary" style={styles.authorLine}>
                  {author}
                </ThemedText>
              ) : null}
              {note ? (
                <View style={[styles.bubbleRow, styles.unsentRow, styles.rowTheirs]}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {note}
                  </ThemedText>
                </View>
              ) : unsent ? (
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
                          setMenu(
                            rect
                              ? {
                                  ...rect,
                                  x: rect.x - origin.current.x,
                                  y: rect.y - origin.current.y,
                                  message: item,
                                  mine,
                                }
                              : // No measurement yet. The menu still opens,
                                // parked mid-thread, and jumps onto the
                                // message when the measurement lands.
                                {
                                  x: 0,
                                  y: Math.max(hostHeight / 2 - UNMEASURED_HEIGHT / 2, 0),
                                  width: 0,
                                  height: UNMEASURED_HEIGHT,
                                  message: item,
                                  mine,
                                }
                          )
                      : undefined
                  }
                />
              )}
            </View>
          );
        }}
        ListEmptyComponent={emptyState}
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
  authorLine: {
    marginLeft: Space.lg,
    marginBottom: 2,
  },
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
    minHeight: ACTION_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Space.lg,
  },
});
