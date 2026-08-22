import { SymbolView } from 'expo-symbols';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Elevation, HitTarget, Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { isLocalId, type ThreadMessage } from '@/features/chat/outgoing';
import { separatorFor } from '@/features/chat/separators';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { MessageRow, ReactionSummaryRow } from '@/lib/database.types';

/** The six people actually use, in the order the muscle memory expects. */
export const QUICK_REACTIONS = ['❤️', '😂', '👍', '🔥', '😮', '🙏'];

/**
 * What the six do not cover, chosen for this app rather than in general:
 * people arranging to meet in a city want to answer with a beer, a plane, a
 * plate, a time, and a yes. Curated and static on purpose — a full system
 * picker is a native dependency, and a search field in a reaction menu is a
 * different app's problem.
 */
export const MORE_REACTIONS = [
  '❤️',
  '😂',
  '👍',
  '🔥',
  '😮',
  '🙏',
  '👀',
  '🍺',
  '☕️',
  '🍜',
  '✈️',
  '🎒',
  '🏖️',
  '🥾',
  '🎉',
  '💯',
  '👋',
  '🙌',
  '😅',
  '🤝',
  '⏰',
];

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

/**
 * The menu's own scrim, darker than theme.scrim.
 *
 * theme.scrim is tuned for a sheet, which covers most of the screen and is
 * its own bright surface — a light touch is enough there. Here the dimmed
 * thing sits directly around the menu, and rgba(6,7,16,0.62) over the dark
 * theme's #0E1020 lands on #090A16: a real change on paper and no change at
 * all to look at, so the menu read as a pill floating over a live thread and
 * the date separator underneath stayed perfectly legible. Screenshot 25 of
 * E2E run 35 is that, photographed.
 *
 * 0.86 was still not enough. Run 37 showed the thread's own date separator
 * reading clearly THROUGH the scrim, landing between the lifted message and
 * the Unsend card — so the menu appeared to contain a stray line of text. The
 * lifted copy sits above the original (the group shifts up to fit the actions
 * underneath), which is what puts the separator in the gap. At 0.95 the thread
 * behind is a hint of depth rather than legible content.
 *
 * Not a theme token, because every sheet in the app uses that one and none of
 * them asked for this.
 */
/**
 * The backdrop behind a lifted message.
 *
 * Blurred where iOS can blur, which is what Messages does and what makes the
 * lifted bubble read as ABOVE the thread rather than pasted over a black
 * rectangle. The tint is on the glass rather than instead of it: a blur
 * alone does not dim, and this menu's whole job is to say "only this
 * message matters right now".
 *
 * No new native module — expo-glass-effect already ships in the binary
 * (docs/DESIGN.md), so this reaches the founder's phone over the air rather
 * than costing an EAS build.
 *
 * The flat value is the fallback and is deliberately near-opaque: a
 * translucent scrim over a dark thread did not read at all, which is the bug
 * this menu has already been fixed for once.
 */
const RUN_AVATAR = 26;
const MENU_SCRIM = 'rgba(2,3,9,0.95)';
const MENU_GLASS_TINT = 'rgba(2,3,9,0.62)';

type Rect = { x: number; y: number; width: number; height: number };

/** A message's box in WINDOW coordinates, plus what it is. */
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
          // The chip is drawn at ~22pt because a taller one would crowd the
          // bubble it hangs off. The TARGET is 44, which is what this buys.
          hitSlop={{ top: 11, bottom: 11, left: 6, right: 6 }}
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
/**
 * The face at the foot of somebody's run in a group thread.
 *
 * Always occupies its space, even when there is no photo and even on the
 * bubbles that do not carry it — otherwise every bubble in a run would sit
 * at a different indent and the column would zig-zag.
 */
function RunAvatar({ path }: { path: string | null }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(path);
  return (
    <View style={[styles.runAvatar, path ? { backgroundColor: theme.surfaceSunken } : undefined]}>
      {url ? (
        <Image source={{ uri: url }} style={styles.runAvatarImage} contentFit="cover" />
      ) : null}
    </View>
  );
}

function BubbleBody({
  message,
  mine,
  tailed,
}: {
  message: ThreadMessage;
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
        // Reduced, not hidden: the words are there, they just have not landed.
        message.local === 'sending' && styles.bubbleSending,
        message.local === 'failed' && { borderWidth: 1, borderColor: theme.danger },
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
  onRetry,
  avatarPath,
}: {
  message: ThreadMessage;
  mine: boolean;
  /** Same sender as the message before it, close in time. */
  grouped: boolean;
  /** Last of its group — the one that gets the tail. */
  last: boolean;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (emoji: string, on: boolean) => void;
  onOpenMenu?: (rect: Rect | null) => void;
  /** Re-send a message that failed. Absent for anything already delivered. */
  onRetry?: () => void;
  /** Group threads only: the sender's face, at the foot of their run. */
  avatarPath?: string | null;
}) {
  const anchor = useRef<View>(null);

  return (
    <View
      style={[
        styles.bubbleRow,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: grouped ? 2 : Space.sm },
      ]}>
      {avatarPath !== undefined && !mine ? <RunAvatar path={avatarPath} /> : null}
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
                    const open = () => {
                      onOpenMenu(null);
                      anchor.current?.measureInWindow((x, y, width, height) => {
                        if (width > 0 && height > 0) {
                          onOpenMenu({ x, y, width, height });
                        }
                      });
                    };

                    if (!Keyboard.isVisible()) {
                      open();
                      return;
                    }

                    // The keyboard goes, the way it does in Messages. The
                    // menu has to WAIT for it rather than race it: the thread
                    // stands on a keyboard-sized floor (KeyboardFloor) and an
                    // inverted list is anchored to its own bottom, so every
                    // bubble slides down by the keyboard's height as that
                    // floor collapses. Measuring before the slide would pin
                    // the menu to where the message used to be — off by
                    // roughly a third of the screen.
                    let settled = false;
                    let hidden: { remove: () => void } | null = null;
                    let failsafe: ReturnType<typeof setTimeout> | null = null;
                    const openOnceStill = () => {
                      if (settled) {
                        return;
                      }
                      settled = true;
                      hidden?.remove();
                      if (failsafe) {
                        clearTimeout(failsafe);
                      }
                      // Two frames past the event. keyboardDidHide says the
                      // SYSTEM keyboard has finished; the floor above it is a
                      // Reanimated style, and measureInWindow reads whatever
                      // the native view's frame is at that instant.
                      requestAnimationFrame(() => requestAnimationFrame(open));
                    };
                    hidden = Keyboard.addListener('keyboardDidHide', openOnceStill);
                    // A long press must always produce a menu, so a
                    // keyboardDidHide that never lands cannot be the only way
                    // out. Slightly longer than iOS's own 250ms dismissal.
                    failsafe = setTimeout(openOnceStill, 400);
                    Keyboard.dismiss();
                  }
                : undefined
            }>
            <BubbleBody message={message} mine={mine} tailed={last} />
          </PressableScale>
        </View>
        {/* The delivery ladder. "Sending" is honest about the pause the
            first-message moderation check creates; a failure keeps the words
            and offers the way out rather than deleting the sentence. */}
        {message.local ? (
          <PressableScale
            accessibilityRole={message.local === 'failed' ? 'button' : 'text'}
            accessibilityLabel={
              message.local === 'failed' ? 'Not sent. Tap to try again.' : 'Sending'
            }
            haptic="none"
            scaleTo={message.local === 'failed' ? 0.96 : 1}
            onPress={message.local === 'failed' ? onRetry : undefined}
            style={styles.statusRow}>
            <ThemedText
              type="caption"
              themeColor={message.local === 'failed' ? 'danger' : 'textSecondary'}>
              {message.local === 'failed' ? 'Not sent. Tap to try again.' : 'Sending…'}
            </ThemedText>
          </PressableScale>
        ) : null}
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
  existingEmoji,
  onPick,
  onPin,
  onUnsend,
  onReport,
  reportLabel,
  onClose,
}: {
  target: MenuTarget;
  existingEmoji: string | null;
  onPick: (emoji: string) => void;
  /** Room hosts only: keep this message at the top of the room. */
  onPin?: () => void;
  onUnsend?: () => void;
  onReport?: () => void;
  reportLabel: string;
  onClose: () => void;
}) {
  const theme = useTheme();
  const mine = target.mine;
  // Six quick reactions cover most of what people say back, and the seventh
  // slot is the honest admission that they do not cover a beer, a flag, or a
  // plane. Opening the grid replaces the row in place rather than stacking
  // another layer over an already-layered menu.
  const [grid, setGrid] = useState(false);

  const actions: { label: string; run: () => void }[] = [];
  if (onPin) {
    actions.push({ label: 'Pin to the top', run: onPin });
  }
  if (onUnsend) {
    actions.push({ label: 'Unsend', run: onUnsend });
  }
  if (onReport) {
    actions.push({ label: reportLabel, run: onReport });
  }

  const { fontScale, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const top = target.y;
  // Scaled by the reader's own type size. The rows grow with it (minHeight,
  // not height — Unsend and Report were being clipped at larger settings),
  // and this estimate has to grow with them or the shift below would push
  // the card off the bottom of the screen instead of keeping it on.
  const rowHeight = ACTION_HEIGHT * Math.min(Math.max(fontScale, 1), ACTION_SCALE_CAP);
  const actionsHeight = actions.length * rowHeight + Space.xs * 2;

  // Keep the pill, the message and the actions on screen as one block.
  //
  // Against the WINDOW now, not the thread: the menu is presented in a modal
  // so that the scrim reaches the header and the composer too, which means
  // the space it has to fit in is the whole screen minus what the notch and
  // the home indicator eat.
  const ceiling = insets.top + Space.md;
  const floor = windowHeight - Math.max(insets.bottom, Space.md);
  const wantedTop = top - LIFT_GAP - PILL_HEIGHT - Space.md;
  const wantedBottom = top + target.height + LIFT_GAP + actionsHeight + Space.md;
  let shift = 0;
  if (wantedBottom > floor) {
    shift = floor - wantedBottom;
  }
  if (wantedTop + shift < ceiling) {
    shift = ceiling - wantedTop;
  }

  return (
    <Animated.View
      // An identifier as well as the Dismiss label, so a failing run says
      // WHICH way it failed: no id and no label means the press never
      // arrived, while the id alone means the layer mounted and something
      // kept it invisible. An accessibilityIdentifier survives on a view at
      // opacity 0; an accessibilityLabel does not.
      testID="message-menu"
      entering={FadeIn.duration(120)}
      // No exiting animation: the modal below unmounts this subtree the
      // instant `visible` flips, so an exit would have nothing to play on.
      style={[
        styles.menuLayer,
        isLiquidGlassAvailable() ? undefined : { backgroundColor: MENU_SCRIM },
      ]}>
      {isLiquidGlassAvailable() ? (
        <GlassView
          glassEffectStyle="regular"
          colorScheme="dark"
          tintColor={MENU_GLASS_TINT}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
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
          style={[
            grid ? styles.pillGrid : styles.pill,
            Elevation.floating,
            { backgroundColor: theme.surface },
          ]}>
          {(grid ? MORE_REACTIONS : QUICK_REACTIONS).map((emoji) => (
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
          {grid ? null : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="More reactions"
              haptic="light"
              scaleTo={0.85}
              onPress={() => setGrid(true)}
              style={[styles.pillItem, { backgroundColor: theme.surfaceSunken }]}>
              <SymbolView
                name={{ ios: 'plus', android: 'add', web: 'add' }}
                size={17}
                tintColor={theme.textSecondary}
              />
            </PressableScale>
          )}
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
  onPin,
  onUnsend,
  onReport,
  reportLabel = 'Report',
  authorFor,
  avatarFor,
  noteFor,
  canReact = true,
  emptyState,
  footer,
  onRetry,
}: {
  messages: ThreadMessage[];
  ownUserId: string | null;
  /** Whose name goes on "X unsent a message". */
  otherName?: string | null;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (messageId: string, emoji: string, on: boolean) => void;
  /**
   * Room hosts only: keep this message at the top of the room. Absent
   * everywhere else, which is what keeps the action out of the menu for
   * anybody who could not carry it out.
   */
  onPin?: (messageId: string) => void;
  onUnsend?: (messageId: string) => void;
  onReport?: (messageId: string) => void;
  /**
   * What the second action is called. A one-to-one chat and an ordinary room
   * member are reporting; a room's moderator is removing, and the button used
   * to say "Report" while the confirmation it opened said "Remove this
   * message?" — two different acts under one word.
   */
  reportLabel?: string;
  /**
   * Who sent this, when that is not obvious. A one-to-one chat has exactly
   * two people and needs no labels; a group has to say. Returns the name to
   * print above the first bubble of somebody's run, or null for no label.
   */
  authorFor?: (message: ThreadMessage) => string | null;
  /**
   * The sender's photo, for a group thread's run-final avatar. Same
   * question as authorFor, answered with a picture; null where there is no
   * photo, and absent entirely in a one-to-one chat, which needs neither.
   */
  avatarFor?: (message: ThreadMessage) => string | null;
  /**
   * A line to print in place of the bubble — "Message removed by the host".
   * Unsending already works this way internally; this opens the same slot to
   * a caller whose messages can be taken down by somebody else.
   */
  noteFor?: (message: ThreadMessage) => string | null;
  /** False for somebody reading a room they have not joined. */
  canReact?: boolean;
  /** Shown when there are no messages at all. */
  emptyState?: React.ReactElement | null;
  /** Rendered above the oldest message (inverted list ⇒ list footer). */
  footer?: React.ReactElement | null;
  /** Re-send a message that failed to leave the device. */
  onRetry?: (message: ThreadMessage) => void;
}) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  const byMessage = new Map<string, ReactionSummaryRow[]>();
  for (const row of reactions) {
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), row]);
  }

  const mineFor = (m: MessageRow) => m.sender_id === ownUserId;
  const myEmojiOn = (messageId: string) =>
    (byMessage.get(messageId) ?? []).find((r) => r.reacted_by_me)?.emoji ?? null;

  return (
    <View style={styles.flex}>
      <FlatList
        style={styles.flex}
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardDismissMode="interactive"
        // WITHOUT THIS, A LONG PRESS ON A BUBBLE DOES NOTHING while the
        // composer has focus, and this is the whole reason the reaction menu
        // never opened. Left unset, a ScrollView defaults to 'never', and
        // React Native's own comment for that case reads: "the first tap
        // should be sent to the scroll view and dismiss the keyboard, then
        // the second tap goes to the actual interior view". It enforces that
        // by claiming the responder in the CAPTURE phase
        // (ScrollView _handleStartShouldSetResponderCapture), before the
        // bubble is ever asked — and Pressability arms its long-press timer
        // only inside onResponderGrant, so the timer is not cancelled, it is
        // never scheduled. On release the scroll view blurs the composer,
        // which is exactly what E2E run 34 photographed: keyboard gone,
        // thread slid down a keyboard's height, no menu.
        //
        // 'handled' and not 'always': a Pressable claims the responder in the
        // bubble phase and so still wins the bubble, while a tap on empty
        // thread space finds no claimant and falls through to the list, which
        // keeps tap-anywhere-to-dismiss. 'always' would take that away with
        // nothing to replace it. The traps note about 'handled' swallowing a
        // first tap applies to text FIELDS, which do not claim the responder;
        // there are none inside this list.
        keyboardShouldPersistTaps="handled"
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
          // A message the server has never seen has no id to hang a reaction
          // or a report off, so the menu stays shut until it lands.
          const reactable =
            canReact &&
            !item.id.startsWith('first:') &&
            !isLocalId(item.id) &&
            !unsent &&
            note == null;
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
                  // Beside the last bubble of a run, not every bubble: a
                  // column of the same face down the side of a thread is
                  // noise, and the run's foot is where the eye already is.
                  //
                  // undefined vs null is load-bearing. undefined means "this
                  // thread has no avatars at all" (a one-to-one chat) and no
                  // column is reserved; null means "a group, but not this
                  // bubble" and the space is held so a run does not zig-zag.
                  avatarPath={avatarFor ? (!mine && last ? avatarFor(item) : null) : undefined}
                  reactions={byMessage.get(item.id) ?? []}
                  onToggleReaction={(emoji, on) => onToggleReaction(item.id, emoji, on)}
                  onRetry={item.local === 'failed' && onRetry ? () => onRetry(item) : undefined}
                  onOpenMenu={
                    reactable
                      ? (rect) =>
                          setMenu(
                            rect
                              ? // Window coordinates, straight through: the
                                // menu is presented in a modal, so its
                                // coordinate space is the screen.
                                { ...rect, message: item, mine }
                              : // No measurement yet. The menu still opens,
                                // parked mid-screen, and jumps onto the
                                // message when the measurement lands.
                                {
                                  x: 0,
                                  y: Math.max(windowHeight / 2 - UNMEASURED_HEIGHT / 2, 0),
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

      {/* In a modal, so the scrim covers the header and the composer too. An
          overlay inside this component can only ever dim the thread, which
          left the chrome above and below it at full brightness while the menu
          was open. Nothing else reaches them from here. */}
      <Modal
        transparent
        visible={menu != null}
        animationType="none"
        onRequestClose={() => setMenu(null)}>
        {menu ? (
          <MessageMenu
            target={menu}
            existingEmoji={myEmojiOn(menu.message.id)}
            reportLabel={reportLabel}
            onPick={(emoji) => {
              // Tapping the one you already used takes it back; tapping a
              // different one moves yours, since a person gets one reaction.
              const current = myEmojiOn(menu.message.id);
              onToggleReaction(menu.message.id, emoji, current !== emoji);
              setMenu(null);
            }}
            onPin={
              onPin
                ? () => {
                    const id = menu.message.id;
                    setMenu(null);
                    onPin(id);
                  }
                : undefined
            }
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
      </Modal>
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
  runAvatar: {
    width: RUN_AVATAR,
    height: RUN_AVATAR,
    borderRadius: RUN_AVATAR / 2,
    overflow: 'hidden',
    alignSelf: 'flex-end',
    marginRight: Space.xs,
    marginBottom: 2,
  },
  runAvatarImage: {
    width: '100%',
    height: '100%',
  },
  bubbleSending: {
    opacity: 0.55,
  },
  statusRow: {
    alignSelf: 'flex-end',
    paddingTop: 2,
    paddingHorizontal: Space.xs,
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
  pillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Seven across on any phone this ships to, which keeps the grid the
    // same shape as the row it replaced.
    maxWidth: HitTarget * 7 + Space.xs * 8,
    gap: Space.xs,
    padding: Space.sm,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
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
