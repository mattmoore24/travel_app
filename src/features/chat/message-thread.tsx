import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Modal,
  Share,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SHEET_SETTLE_MS, useRegisterNativeModal } from '@/components/ui/sheet';
import { Elevation, HitTarget, Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { splitLinks } from '@/features/chat/links';
import { usePhotoUrl } from '@/features/profile/hooks';
import { isLocalId, type ThreadMessage } from '@/features/chat/outgoing';
import { separatorFor } from '@/features/chat/separators';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { MessageRow, ReactionSummaryRow } from '@/lib/database.types';

/**
 * The six on the row, in the order the muscle memory expects.
 *
 * The heart is here by an explicit founder exception to "no hearts"
 * (docs/DESIGN.md principle 5, and the design-review skill). The rule is
 * about the ROMANTIC vocabulary - a like button, a heart you spend on a
 * person, a match ceremony - and a tapback is none of those: it is the
 * iMessage grammar everyone already has in their thumbs, and the thing it
 * marks is a message, not a person. Recorded in both places too, so the rule
 * and the app agree rather than quietly contradicting each other.
 */
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

/**
 * The "more reactions" grid, measured rather than assumed.
 *
 * The block is positioned from its TOP, before it lays out, so whatever is
 * used for its height has to be the real one. It was PILL_HEIGHT for both
 * shapes, which is fine for the six-emoji row and 152pt short for the grid:
 * the extra grew downward over the lifted bubble and the Unsend/Report card,
 * both of which are painted after it, so the bottom two rows were invisible
 * and a tap aimed at one of them landed on Report.
 */
const GRID_COLUMNS = 6;
const GRID_ROWS = Math.ceil(MORE_REACTIONS.length / GRID_COLUMNS);
const GRID_WIDTH = HitTarget * GRID_COLUMNS + Space.xs * (GRID_COLUMNS - 1) + Space.sm * 2;
const GRID_HEIGHT = HitTarget * GRID_ROWS + Space.xs * (GRID_ROWS - 1) + Space.sm * 2;

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

/** The face at the foot of somebody's run in a group thread, in points. */
const RUN_AVATAR = 26;
/**
 * The dim behind a lifted message, darker than theme.scrim.
 *
 * Before reaching for a different opacity, know what the last three values
 * bought. This climbed 0.62 → 0.86 → 0.88-with-a-GlassView-blur chasing
 * content that kept reading through, and the worst of that content was the
 * pressed MESSAGE itself: the overlay paints a lifted COPY of the bubble
 * while the original stays mounted in the thread underneath, so any scrim
 * thin enough to leave the thread as depth left the original as a legible
 * double directly under the copy. No opacity wins that fight. The real fix
 * is Bubble's `lifted` prop, which blanks the source row while its copy is
 * up — the same trick Messages uses.
 *
 * With the ghost gone, the scrim's remaining job is the chrome: the header,
 * the composer and the day separators must read as BEHIND the menu, not
 * beside it. Near-opaque because run 37 photographed a day separator legible
 * through 0.86. The GlassView blur went out with the opacity ladder: on iOS
 * 26.2, where Liquid Glass IS available, it rendered nothing anybody could
 * see — a dim that depends on a GPU effect being present and effective is
 * not a dim — and under a near-opaque scrim a blur is a GPU effect nobody
 * can see by construction.
 *
 * Not a theme token, because every sheet in the app uses theme.scrim and
 * none of them asked for this.
 */
const MENU_SCRIM = 'rgba(2,3,9,0.95)';

type Rect = { x: number; y: number; width: number; height: number };

/** A message's box in WINDOW coordinates, plus what it is. */
type MenuTarget = Rect & {
  message: MessageRow;
  mine: boolean;
};

function Reactions({
  rows,
  mine,
  onToggle,
}: {
  rows: ReactionSummaryRow[];
  /** On your own right-aligned bubble the chip hangs off the bubble's own
   * trailing edge rather than drifting to the column's far side. */
  mine: boolean;
  onToggle: (emoji: string, on: boolean) => void;
}) {
  const theme = useTheme();
  if (rows.length === 0) {
    return null;
  }
  return (
    <View style={[styles.reactionRow, { alignSelf: mine ? 'flex-end' : 'flex-start' }]}>
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
function RunAvatar({
  path,
  name,
  onPress,
}: {
  path: string | null;
  name: string | null;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(path);
  // name is what separates the two kinds of empty. A bubble that is not the
  // foot of a run passes null for both and stays a pure spacer; the foot of
  // a run always carries a name, so somebody with no photo gets a monogram
  // rather than the hole that used to sit there.
  const filled = name != null;
  const initial = name?.trim()?.[0]?.toUpperCase() ?? null;
  const style = [
    styles.runAvatar,
    path || filled ? { backgroundColor: theme.surfaceSunken } : undefined,
  ];
  const face = url ? (
    <Image source={{ uri: url }} style={styles.runAvatarImage} contentFit="cover" />
  ) : initial ? (
    <ThemedText type="caption" themeColor="textSecondary" style={styles.runAvatarInitial}>
      {initial}
    </ThemedText>
  ) : null;

  // A face in a group thread is the most natural thing in the app to tap, and
  // it did nothing. Only the foot of somebody else's run is live — the
  // spacers that hold the column straight carry no name and must not be
  // reachable by VoiceOver as buttons to nowhere.
  if (!onPress || !filled) {
    return <View style={style}>{face}</View>;
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${name}'s profile`}
      haptic="soft"
      scaleTo={0.92}
      hitSlop={6}
      onPress={onPress}
      style={style}>
      {face}
    </PressableScale>
  );
}

function BubbleBody({
  message,
  mine,
  tailed,
  onSpanLongPress,
}: {
  message: ThreadMessage;
  mine: boolean;
  /** Last of its group: the corner that gets the tail. */
  tailed: boolean;
  /**
   * The bubble's own menu-open handler, forwarded to link spans: a pressable
   * text fragment claims the touch responder, so the ancestor PressableScale
   * never arms its long-press for a hold that lands ON the link. Without
   * this, a message that is entirely a URL (the classic spam shape) has no
   * reachable menu, and holding it OPENS the link on release.
   */
  onSpanLongPress?: () => void;
}) {
  const theme = useTheme();
  const { data: imageUrl } = useChatPhotoUrl(message.image_path);
  const tail = tailed ? Radius.xs : Radius.bubble;
  const checking = message.moderation_status === 'pending';

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
      {/* `checking` rather than `image_path`, because a room MASKS the path
          until a verdict lands — so keying off the path drew nothing at all
          for everybody but the sender, which is the empty bubble people were
          looking at. */}
      {checking ? (
        <PhotoCheck url={imageUrl ?? null} />
      ) : message.image_path ? (
        imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="cover" />
        ) : (
          // The path is there and the signing call has not answered yet.
          // Same frame, so the bubble does not resize under the thread when
          // it does.
          <View style={[styles.photo, { backgroundColor: theme.surfaceSunken }]} />
        )
      ) : null}
      {message.body ? (
        <ThemedText style={mine ? { color: theme.onAccentDeep } : undefined}>
          {/* A URL in a message used to be dead grey text, and §7 rule 4
              means a chat is the only place one can arrive. Nested Text, not
              `dataDetectorType`: that prop is Android-only on Text (and the
              TextInput spelling does nothing here either), so on an iOS-first
              app it reads as a fix and does nothing on a device.

              Underlined AND recoloured, because on your own accentDeep
              bubble the accent has no contrast — there the underline carries
              the whole "this is a link" on its own, in onAccentDeep. */}
          {splitLinks(message.body).map((span, index) =>
            span.url ? (
              <ThemedText
                key={`${index}-${span.text}`}
                style={[styles.link, { color: mine ? theme.onAccentDeep : theme.accent }]}
                onLongPress={onSpanLongPress}
                onPress={() => {
                  const url = span.url;
                  if (!url) {
                    return;
                  }
                  try {
                    // Leaves the app rather than pushing a route, so it is
                    // safe from inside anything presented (see traps).
                    Linking.openURL(url).catch(() => {});
                  } catch {
                    // A malformed URL is not worth an error screen.
                  }
                }}>
                {span.text}
              </ThemedText>
            ) : (
              span.text
            )
          )}
        </ThemedText>
      ) : null}
    </View>
  );
}

/**
 * How long people should expect to wait for a photo to clear.
 *
 * An estimate from the measured chain rather than a hope: the insert now pokes
 * the worker directly (20260828170000) instead of waiting on a once-a-minute
 * cron, chat photos drain before every other queue, and the classification
 * runs at low effort. That is a cold start, a signed URL and one vision call.
 *
 * `admin_moderation_latency` measures the real thing, per queue, over the last
 * seven days. When there is enough live traffic to read a p95 off it, this
 * number comes from there — and a promise nobody can keep is worse than no
 * promise, so if it turns out slower this says so instead.
 */
const PHOTO_CHECK_SECONDS = 5;

/**
 * A photo waiting on its verdict, at the size the photo itself will be.
 *
 * It used to be the words "Photo in review" in a text bubble — a tiny grey
 * rectangle that then jumped to 220pt square when the picture arrived, which
 * is the founder's "tiny bubble". Reserving the real frame means nothing in
 * the thread moves when the verdict lands, and saying WHY out loud is the
 * honest version of a blank space: every photo in this app is checked, and a
 * person who knows that is waiting rather than wondering.
 *
 * The sender sees their own picture behind the scrim (storage lets them read
 * their own upload before it clears, and the room RPC unmasks it for them);
 * everybody else sees the frame. Both read the same sentence.
 */
function PhotoCheck({ url }: { url: string | null }) {
  const theme = useTheme();
  return (
    <View style={[styles.photo, styles.photoCheck, { backgroundColor: theme.surfaceSunken }]}>
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : null}
      <View
        style={[StyleSheet.absoluteFill, styles.photoCheckVeil, { backgroundColor: theme.scrim }]}>
        {/* On a solid card, not straight onto the scrim. The scrim sits over
            the sender's own photo, so the effective background is whatever
            they photographed: textSecondary over a 0.62 veil on a bright
            picture measures 2.5:1, and no veil opacity fixes that without
            hiding the photo this card exists to show. A card makes the ratio
            the palette's, whatever is behind it. */}
        <View style={[styles.photoCheckCard, { backgroundColor: theme.surface }]}>
          <ActivityIndicator color={theme.textSecondary} />
          <ThemedText type="callout" style={styles.photoCheckTitle}>
            Checking this photo
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.photoCheckNote}>
            We check every photo before it goes out. Usually about {PHOTO_CHECK_SECONDS} seconds.
          </ThemedText>
        </View>
      </View>
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
  avatarName,
  onOpenSender,
  delivered = false,
  lifted = false,
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
  /** The name behind that face, for the monogram when there is no photo. */
  avatarName?: string | null;
  /** Tapping that face. Absent in a one-to-one chat, where it is your own. */
  onOpenSender?: () => void;
  /**
   * Say "Sent" under this one.
   *
   * True for the NEWEST of your own messages that has actually landed, and
   * nothing else — which is the rule every messaging app follows, and the
   * reason it works: a column of "Sent" down the side of a thread carries no
   * information, while one under the last thing you wrote answers the only
   * question you were asking.
   */
  delivered?: boolean;
  /**
   * The long-press menu is open on THIS message, and the copy it paints
   * above its scrim is standing in for it. Blank the row (opacity, never
   * `display: 'none'` and never a conditional return: the measureInWindow
   * rect the menu was positioned from must stay valid, and the row's height
   * must stay in the layout or the list reflows under the open menu) so the
   * words appear once, not as a ghost under the lifted copy — which no scrim
   * opacity could hide, and which is what Messages blanks too.
   */
  lifted?: boolean;
}) {
  const anchor = useRef<View>(null);

  const bodyLinks = message.body ? splitLinks(message.body).filter((span) => span.url) : [];
  // Hoisted so the link spans inside BubbleBody can arm the same long-press
  // (see onSpanLongPress there): one handler, whoever's press wins.
  const openMenu = onOpenMenu
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
    : undefined;

  return (
    <View
      testID={`bubble-${message.id}`}
      style={[
        styles.bubbleRow,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: grouped ? 2 : Space.sm },
        // A view at opacity 0 is skipped by UIKit hit-testing (traps), which
        // is harmless here: the menu's modal is over the whole screen for as
        // long as this is blank.
        lifted && styles.rowLifted,
      ]}>
      {avatarPath !== undefined && !mine ? (
        <RunAvatar path={avatarPath} name={avatarName ?? null} onPress={onOpenSender} />
      ) : null}
      <View style={styles.bubbleColumn}>
        {/* A plain view around the pressable, because the menu needs to know
            where on screen this bubble actually is and PressableScale keeps
            its animated inner view to itself. */}
        <View ref={anchor} collapsable={false}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={message.body ?? 'Photo'}
            accessibilityHint={onOpenMenu ? 'Press and hold to react' : undefined}
            // VoiceOver collapses the bubble into one element, so the link
            // spans inside are unreachable by touch there; the URL is offered
            // as a rotor action instead.
            accessibilityActions={
              bodyLinks.length > 0
                ? [{ name: 'openLink', label: `Open ${bodyLinks[0].text}` }]
                : undefined
            }
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'openLink' && bodyLinks[0]?.url) {
                Linking.openURL(bodyLinks[0].url).catch(() => {});
              }
            }}
            haptic="none"
            scaleTo={0.98}
            delayLongPress={220}
            onLongPress={openMenu}>
            <BubbleBody message={message} mine={mine} tailed={last} onSpanLongPress={openMenu} />
          </PressableScale>
        </View>
        {/* The marks under a bubble stack in one column — reaction first,
            delivery status beneath it — so both read as marks ON the message
            above rather than a two-column row of unrelated controls. */}
        <Reactions rows={reactions} mine={mine} onToggle={onToggleReaction} />
        {/* The delivery ladder, in full: Sending, then Sent, or Not sent with
            the way out. "Sending" is honest about the pause the first-message
            moderation check creates; "Sent" is the confirmation the founder
            asked for, and it is worth having precisely because this app makes
            people wait more than most. A failure keeps the words and offers
            the retry rather than deleting the sentence.

            A photo still being checked gets neither: it has not been
            delivered to anybody yet, and its own tile is already saying so. */}
        {message.local || (delivered && message.moderation_status !== 'pending') ? (
          <PressableScale
            accessibilityRole={message.local === 'failed' ? 'button' : 'text'}
            accessibilityLabel={
              message.local === 'failed'
                ? 'Not sent. Tap to try again.'
                : message.local === 'sending'
                  ? 'Sending'
                  : 'Sent'
            }
            haptic="none"
            scaleTo={message.local === 'failed' ? 0.96 : 1}
            // The only route back from a failed send, and it was a 16pt
            // strip of caption wedged between the bubble and the reaction
            // row: a miss landed on the bubble and opened the long-press
            // menu instead. The line stays small because it is a status, not
            // a button — the target around it does not.
            hitSlop={message.local === 'failed' ? { top: 8, bottom: 14, left: 16, right: 8 } : 0}
            onPress={message.local === 'failed' ? onRetry : undefined}
            style={styles.statusRow}>
            {/* footnote, not caption: 13/400 reads as a quiet status, where
                caption's 11pt-semibold-letterspaced voice is a section
                heading and shouted louder than the message above it. */}
            <ThemedText
              type="footnote"
              themeColor={message.local === 'failed' ? 'danger' : 'textSecondary'}>
              {message.local === 'failed'
                ? 'Not sent. Tap to try again.'
                : message.local === 'sending'
                  ? 'Sending…'
                  : 'Sent'}
            </ThemedText>
          </PressableScale>
        ) : null}
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
  canReact,
  onPick,
  onPin,
  onShare,
  onRemove,
  onUnsend,
  onReport,
  onClose,
}: {
  target: MenuTarget;
  existingEmoji: string | null;
  /** False for somebody who may flag a message but not react to it. */
  canReact: boolean;
  onPick: (emoji: string) => void;
  /** Room hosts only: keep this message at the top of the room. */
  onPin?: () => void;
  /** The system share sheet — which IS the text/email/copy chooser. */
  onShare?: () => void;
  /** Room moderators only: take this message down for everyone. */
  onRemove?: () => void;
  onUnsend?: () => void;
  onReport?: () => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const mine = target.mine;
  // Six quick reactions cover most of what people say back, and the seventh
  // slot is the honest admission that they do not cover a beer, a flag, or a
  // plane. Opening the grid replaces the row in place rather than stacking
  // another layer over an already-layered menu.
  const [grid, setGrid] = useState(false);

  // `destructive` decides the colour. Every row used to be painted
  // theme.danger, so "Pin to the top" — an act of curation, the one
  // affirming thing a host can do to a message — arrived in the same red as
  // Unsend. Red means "this takes something away"; if it means everything it
  // means nothing.
  const actions: { label: string; run: () => void; destructive: boolean }[] = [];
  if (onPin) {
    actions.push({ label: 'Pin to the top', run: onPin, destructive: false });
  }
  // "Share", not "Copy": the system share sheet is where text, email and
  // copy already live, and a control says exactly what happens.
  if (onShare) {
    actions.push({ label: 'Share', run: onShare, destructive: false });
  }
  // Remove and Report side by side, never one instead of the other: a
  // moderator taking a message down is exactly the person who may also need
  // to escalate it.
  if (onRemove) {
    actions.push({ label: 'Remove', run: onRemove, destructive: true });
  }
  if (onUnsend) {
    actions.push({ label: 'Unsend', run: onUnsend, destructive: true });
  }
  if (onReport) {
    actions.push({ label: 'Report', run: onReport, destructive: true });
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
  // Whichever shape the emoji block is currently in — or nothing at all for
  // a reader who cannot react, whose card must not float a pill's height
  // away from the message it belongs to.
  const pillBlock = canReact ? (grid ? GRID_HEIGHT : PILL_HEIGHT) : 0;
  const wantedTop = top - LIFT_GAP - pillBlock - Space.md;
  const wantedBottom = top + target.height + LIFT_GAP + actionsHeight + Space.md;
  let shift = 0;
  if (wantedBottom > floor) {
    shift = floor - wantedBottom;
  }
  if (wantedTop + shift < ceiling) {
    // The second clamp used to simply overwrite the first, so for a block
    // taller than the screen the top always won and the action card — Report,
    // Unsend — was laid out below the bottom edge of a layer that does not
    // scroll. Report was unreachable on exactly the long message worth
    // reporting. When both cannot be satisfied something has to run off, and
    // it is the top: you already know what the message says, and the reason
    // you opened this is at the bottom.
    shift = Math.min(ceiling - wantedTop, floor - wantedBottom);
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
      // The flat scrim is the whole dim, on purpose — MENU_SCRIM's comment
      // holds the history of the glass blur that used to sit here and why it
      // left. The message the person pressed is not fighting this layer any
      // more either: the thread blanks the source row (Bubble's `lifted`)
      // while the copy above this scrim stands in for it.
      style={[styles.menuLayer, { backgroundColor: MENU_SCRIM }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        haptic="none"
        scaleTo={1}
        onPress={onClose}
        containerStyle={StyleSheet.absoluteFill}
        style={StyleSheet.absoluteFill}
      />

      {/* The emoji row, directly above the message. Not for a reader who
          cannot react — a visitor previewing a public room gets the card
          below (Report and nothing else), never controls that would fail. */}
      {canReact ? (
        <View
          style={[styles.menuSide, { top: top + shift - LIFT_GAP - pillBlock }, sideOf(mine)]}
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
                <ThemedText type="display">{emoji}</ThemedText>
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
      ) : null}

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
                  style={{ color: action.destructive ? theme.danger : theme.text }}>
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
  onRemove,
  onUnsend,
  onReport,
  canReport = true,
  authorFor,
  avatarFor,
  onOpenSender,
  noteFor,
  systemFor,
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
  /**
   * Room moderators only: take this message down for everyone. Its own
   * handler, never a relabelled Report — the moderator used to get "Remove"
   * INSTEAD of "Report", which left the person best placed to spot abuse
   * early with no way to escalate a message they had to delete.
   */
  onRemove?: (messageId: string) => void;
  onUnsend?: (messageId: string) => void;
  onReport?: (messageId: string) => void;
  /** False where reporting is offered but this reader may not use it. */
  canReport?: boolean;
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
   * Opening the person behind a face. Group threads only: in a one-to-one
   * chat the header already carries the other person, and there are no
   * avatars in the column at all.
   */
  onOpenSender?: (senderId: string) => void;
  /**
   * A line to print in place of the bubble — "Message removed by the host".
   * Unsending already works this way internally; this opens the same slot to
   * a caller whose messages can be taken down by somebody else.
   */
  noteFor?: (message: ThreadMessage) => string | null;
  /**
   * A line that belongs to the ROOM, not to anybody in it — "Ana is in",
   * written by the server when somebody joins a plan. Rendered centred with
   * no bubble, no author line and no reactions, because a system fact drawn
   * as a bubble reads as something the person appears to have typed.
   * Distinct from noteFor, whose line stands in for a message somebody DID
   * send and so keeps the theirs-side alignment.
   */
  systemFor?: (message: ThreadMessage) => string | null;
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
  // This one is a raw <Modal> rather than a Sheet, so it has to declare
  // itself. A count that only knows about Sheets is a count that lies, and
  // the thing waiting on it presents into the collision anyway.
  useRegisterNativeModal(menu != null);

  const byMessage = new Map<string, ReactionSummaryRow[]>();
  for (const row of reactions) {
    byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), row]);
  }

  const mineFor = (m: MessageRow) => m.sender_id === ownUserId;
  // The newest of your own messages that actually landed. `messages` is
  // newest-first (the list is inverted), so the first match is it.
  const deliveredId =
    messages.find((m) => m.sender_id === ownUserId && m.local == null)?.id ?? null;
  const myEmojiOn = (messageId: string) =>
    (byMessage.get(messageId) ?? []).find((r) => r.reacted_by_me)?.emoji ?? null;

  return (
    <View style={styles.flex}>
      <FlatList
        style={styles.flex}
        inverted
        data={messages}
        keyExtractor={(m) => m.id}
        // The inline renderItem closes over `menu`, which USUALLY forces a
        // re-render; extraData is the guarantee VirtualizedList re-renders
        // the cells when the menu opens and closes, so the blanked source row
        // (Bubble's `lifted`) tracks the menu rather than trailing it.
        extraData={menu?.message.id}
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
          // A system line breaks a run in both directions. It carries its
          // joiner's sender_id, so without this the first thing somebody says
          // after "X is in" groups against the caption: no author line above
          // their opening bubble, grouped corners butting a centred line.
          const olderIsRun = older != null && systemFor?.(older) == null;
          const newerIsRun = newer != null && systemFor?.(newer) == null;
          const grouped =
            olderIsRun &&
            older.sender_id === item.sender_id &&
            new Date(item.created_at).getTime() - new Date(older.created_at).getTime() <
              GROUP_WINDOW_MS;
          const last =
            !newerIsRun ||
            newer.sender_id !== item.sender_id ||
            new Date(newer.created_at).getTime() - new Date(item.created_at).getTime() >=
              GROUP_WINDOW_MS;
          // The opening message is carried on the chat row, not the messages
          // table, so there is no id for a reaction to hang off.
          const note = noteFor?.(item) ?? null;
          const system = systemFor?.(item) ?? null;
          // A message the server has never seen has no id to hang a reaction
          // or a report off, so the menu stays shut until it lands.
          //
          // Reacting is not the only reason to open the menu: a visitor
          // reading a public room may not react, but flagging abuse must
          // never sit behind the same gate — canReact used to conflate the
          // two, so the surface most likely to show a stranger's message was
          // the one with no menu at all.
          const menuable =
            (canReact || (canReport && onReport != null) || onRemove != null) &&
            !item.id.startsWith('first:') &&
            !isLocalId(item.id) &&
            !unsent &&
            note == null &&
            system == null;
          const separator = separatorFor(item, older);
          // Only above the first bubble of a run, and never above your own:
          // repeating a name on every bubble is what makes a group thread
          // unreadable. A system line has no author at all — the room said
          // it, and the sentence already carries the name.
          const author = !mine && !grouped && system == null ? (authorFor?.(item) ?? null) : null;

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
              {system ? (
                <View style={styles.systemRow}>
                  <ThemedText type="caption" themeColor="textSecondary">
                    {system}
                  </ThemedText>
                </View>
              ) : note ? (
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
                  // Same slot, same condition: whoever owns the face owns the
                  // letter that stands in for it.
                  avatarName={avatarFor && !mine && last ? (authorFor?.(item) ?? null) : null}
                  onOpenSender={
                    onOpenSender && !mine && !isLocalId(item.id)
                      ? () => onOpenSender(item.sender_id)
                      : undefined
                  }
                  reactions={byMessage.get(item.id) ?? []}
                  onToggleReaction={(emoji, on) => onToggleReaction(item.id, emoji, on)}
                  onRetry={item.local === 'failed' && onRetry ? () => onRetry(item) : undefined}
                  delivered={item.id === deliveredId}
                  lifted={menu?.message.id === item.id}
                  onOpenMenu={
                    menuable
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
            canReact={canReact}
            onShare={
              menu.message.body
                ? () => {
                    const body = menu.message.body ?? '';
                    setMenu(null);
                    // The share sheet is a native presentation, and iOS
                    // silently drops one that starts while the menu's modal
                    // is still dismissing — on Fabric that kills touch for
                    // the whole app (see traps). Wait the settle window.
                    setTimeout(() => {
                      Share.share({ message: body }).catch(() => {});
                    }, SHEET_SETTLE_MS);
                  }
                : undefined
            }
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
                    // The vocabulary's destructive word, at the destructive
                    // act. Unsend completed with no feedback at all.
                    haptics.warning();
                    onUnsend(id);
                  }
                : undefined
            }
            onRemove={
              !menu.mine && onRemove
                ? () => {
                    const id = menu.message.id;
                    setMenu(null);
                    onRemove(id);
                  }
                : undefined
            }
            onReport={
              !menu.mine && canReport && onReport
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
  runAvatarInitial: {
    fontWeight: '600',
  },
  runAvatar: {
    width: RUN_AVATAR,
    height: RUN_AVATAR,
    borderRadius: RUN_AVATAR / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
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
  link: {
    textDecorationLine: 'underline',
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
  // Blank but present: the row keeps its measured height and window rect
  // while the menu's lifted copy stands in for it.
  rowLifted: {
    opacity: 0,
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
  photoCheck: {
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  photoCheckVeil: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Space.md,
  },
  photoCheckCard: {
    alignItems: 'center',
    gap: Space.sm,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  photoCheckTitle: {
    fontWeight: '600',
    textAlign: 'center',
  },
  photoCheckNote: {
    textAlign: 'center',
  },
  unsentRow: {
    marginTop: Space.sm,
    paddingHorizontal: Space.sm,
  },
  reactionRow: {
    flexDirection: 'row',
    gap: Space.xs,
    // A small positive gap, not the old -6 overlap: the negative pull was
    // tuned for a chip hanging alone under the bubble and stopped working
    // once the delivery status shared the band beneath it.
    marginTop: 2,
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
  // Centred like a day separator, spaced like a message: a join line belongs
  // to the room, not to either side of the conversation.
  systemRow: {
    alignItems: 'center',
    paddingVertical: Space.sm,
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
    // Six across on any phone this ships to, and the SAME arithmetic the
    // height above is derived from, so the two cannot drift apart.
    maxWidth: GRID_WIDTH,
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
