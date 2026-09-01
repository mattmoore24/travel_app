import { SymbolView } from 'expo-symbols';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
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
import { PhotoCheck } from '@/components/ui/photo-check';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet, SHEET_SETTLE_MS, useRegisterNativeModal } from '@/components/ui/sheet';
import { Elevation, HitTarget, Radius, Space } from '@/constants/theme';
import { useIsBusiness } from '@/features/business/hooks';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { splitLinks } from '@/features/chat/links';
import { usePhotoUrl } from '@/features/profile/hooks';
import { isLocalId, type ThreadMessage } from '@/features/chat/outgoing';
import type { Quote } from '@/features/chat/reply';
import { separatorFor } from '@/features/chat/separators';
import { PinGlyph } from '@/features/pins/pin-marker';
import { pinOnMessage, type MessagePin } from '@/features/rooms/message-pin';
import { useJoinPlanFromMessage, useReactors } from '@/features/rooms/hooks';
import { formatDate } from '@/features/trips/dates';
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

/**
 * How far back the thread will jump to put the New line on screen.
 *
 * There is no getItemLayout here and bubble heights vary, so a jump is an
 * estimate that gets less true the further it reaches. Past this many messages
 * the thread opens where every messaging app opens - at the newest - and the
 * line is found by scrolling, which is honest. The number is also the count of
 * unread messages, since that is what the index counts.
 */
const UNREAD_JUMP_MAX = 30;

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
  onOpenReactors,
}: {
  rows: ReactionSummaryRow[];
  /** On your own right-aligned bubble the chip hangs off the bubble's own
   * trailing edge rather than drifting to the column's far side. */
  mine: boolean;
  onToggle: (emoji: string, on: boolean) => void;
  /**
   * Name the people behind this chip. Absent in a one-to-one chat, where the
   * bare pill is already correct — there is only one other person it could be,
   * and naming them would be a reciprocal-interest reveal by another route.
   */
  onOpenReactors?: () => void;
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
          // The tap stays the toggle. That is the iMessage grammar people
          // already have in their thumbs and it must not move; the hold is the
          // spare gesture, which is where the names go.
          accessibilityHint={onOpenReactors ? 'Press and hold to see who reacted' : undefined}
          haptic="light"
          scaleTo={0.9}
          // The chip is drawn at ~22pt because a taller one would crowd the
          // bubble it hangs off. The TARGET is 44, which is what this buys.
          hitSlop={{ top: 11, bottom: 11, left: 6, right: 6 }}
          onLongPress={onOpenReactors}
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

function QuotedStrip({ quote, mine }: { quote: Quote; mine: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.quote,
        // A leading rule rather than a tinted card: on your own accentDeep
        // bubble a fill would have to be a third colour, and the rule reads
        // the same on both sides.
        { borderLeftColor: mine ? theme.onAccentDeep : theme.accent },
      ]}>
      <ThemedText
        type="caption"
        style={mine ? { color: theme.onAccentDeep } : undefined}
        themeColor={mine ? undefined : 'accent'}
        numberOfLines={1}>
        {quote.name}
      </ThemedText>
      <ThemedText
        type="footnote"
        style={mine ? { color: theme.onAccentDeep } : undefined}
        themeColor={mine ? undefined : 'textSecondary'}
        numberOfLines={1}>
        {/* A parent that was taken back or taken down keeps its name and
            loses its line: nobody goes on reading, inside a quote, something
            the thread itself has stopped showing. A parent that is merely
            older than the loaded pages is a different sentence - it still
            exists, and one more page would show it - so it must never borrow
            the deletion one. */}
        {quote.body ?? (quote.state === 'offPage' ? 'Earlier message' : 'Message no longer here')}
      </ThemedText>
    </View>
  );
}

/**
 * A plan, inside the bubble that carries it.
 *
 * A LEFT RULE, not a filled card, and that is the same answer QuotedStrip
 * reached for the same reason: on your own accentDeep bubble a fill would have
 * to be a third colour, and the rule reads identically on both sides.
 *
 * The glyph is the map's own PinGlyph rather than a category emoji, so the
 * line from marker to card survives the trip into a conversation — the pin
 * marker's comment holds the history of the emoji labels that broke it twice.
 *
 * There is no clock on it. room_messages nulls every pin column the moment the
 * plan expires (hard rule 3), so a card that is on screen at all is a plan
 * that is still on, and a countdown here would only ever be counting down to
 * the card disappearing.
 */
function PinCard({ pin, mine }: { pin: MessagePin; mine: boolean }) {
  const theme = useTheme();
  const join = useJoinPlanFromMessage();
  // "Under no circumstances should a business account ever have the option to
  // join... any other pin of any kind" (the founder, and
  // src/app/__tests__/business-cannot-join.test.ts). The database refuses it
  // too (assert_not_business), but a refusal nobody could have predicted is
  // worse than no button.
  const viewerIsBusiness = useIsBusiness();
  // A guest never reaches this at all: room_messages hands the pin columns to
  // members and moderators only, so a public-preview reader gets the message
  // with no plan on it and this component is never built.
  const ink = mine ? theme.onAccentDeep : theme.text;
  const quiet = mine ? theme.onAccentDeep : theme.textSecondary;

  return (
    <View style={[styles.planCard, { borderStartColor: mine ? theme.onAccentDeep : theme.accent }]}>
      <View style={styles.planHead}>
        <PinGlyph category={pin.category} size={26} />
        <View style={styles.planText}>
          <ThemedText type="smallBold" style={{ color: ink }} numberOfLines={2}>
            {pin.venueName}
          </ThemedText>
          {pin.plan ? (
            <ThemedText type="footnote" style={{ color: quiet }} numberOfLines={2}>
              {pin.plan}
            </ThemedText>
          ) : null}
          <ThemedText type="footnote" style={{ color: quiet }}>
            {formatDate(pin.intentDate)}
          </ThemedText>
        </View>
      </View>
      {/* Not on your own plan: the pin is already yours, and the server would
          answer the tap with the very pin the card is drawn from. */}
      {mine || viewerIsBusiness ? null : (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Join this plan. ${pin.venueName}, ${formatDate(pin.intentDate)}.`}
          accessibilityState={{ disabled: join.isPending }}
          haptic="light"
          scaleTo={0.97}
          // The label is drawn small so it does not shout over the message it
          // sits under; the slop is what makes the TARGET 44. The pill is
          // about 26pt tall (a footnote line plus Space.xs top and bottom), so
          // ten each way clears the floor rather than landing just under it.
          hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
          onPress={() => {
            if (join.isPending) {
              return;
            }
            join.mutate(pin.messageId, {
              // The map is where the answer shows up, so the confirmation is
              // the one the map already gives a posted pin.
              onSuccess: () => haptics.success(),
              // No local onError: the global mutation alert answers with the
              // shared vocabulary (src/lib/failure-message.ts), which is where
              // "active pin limit reached" already has a written sentence.
            });
          }}
          style={[styles.planJoin, { borderColor: theme.accent }]}>
          <ThemedText type="footnote" themeColor="accent">
            {join.isSuccess ? 'You are in' : 'Join this plan'}
          </ThemedText>
        </PressableScale>
      )}
    </View>
  );
}

function BubbleBody({
  message,
  mine,
  tailed,
  quote,
  onSpanLongPress,
}: {
  message: ThreadMessage;
  mine: boolean;
  /** Last of its group: the corner that gets the tail. */
  tailed: boolean;
  /** What this message answers, drawn INSIDE the bubble. */
  quote?: Quote | null;
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
  // Straight off the row rather than through a prop the caller has to
  // remember to pass. room_messages joins the plan onto every message it
  // returns, so a group thread renders the card with no change at either call
  // site — which is the difference between a feature that ships and a
  // component nothing mounts.
  const pin = pinOnMessage(message);

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
      {/* Inside the bubble, above the content. Inside, because an inverted
          list flips a cell's children and a strip emitted as a sibling would
          land under the message it belongs to (traps). */}
      {quote ? <QuotedStrip quote={quote} mine={mine} /> : null}
      {/* The plan this message carries, above the words that came with it.
          `pin` is null in a direct chat, for a public-preview reader, and for
          any plan that has expired — room_messages decides all three, so
          nothing here has to remember hard rule 3 on its own. */}
      {pin ? <PinCard pin={pin} mine={mine} /> : null}
      {/* `checking` rather than `image_path`, because a room MASKS the path
          until a verdict lands — so keying off the path drew nothing at all
          for everybody but the sender, which is the empty bubble people were
          looking at. */}
      {checking ? (
        <PhotoCheck url={imageUrl ?? null} style={styles.photo} />
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

function Bubble({
  message,
  mine,
  grouped,
  last,
  reactions,
  onToggleReaction,
  onOpenReactors,
  onOpenMenu,
  onRetry,
  avatarPath,
  avatarName,
  onOpenSender,
  quote,
  delivered = false,
  lifted = false,
}: {
  message: ThreadMessage;
  mine: boolean;
  /** What this message answers, or null. */
  quote?: Quote | null;
  /** Same sender as the message before it, close in time. */
  grouped: boolean;
  /** Last of its group — the one that gets the tail. */
  last: boolean;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (emoji: string, on: boolean) => void;
  /** Groups and rooms only; see Reactions. */
  onOpenReactors?: () => void;
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
            <BubbleBody
              message={message}
              mine={mine}
              tailed={last}
              quote={quote}
              onSpanLongPress={openMenu}
            />
          </PressableScale>
        </View>
        {/* The marks under a bubble stack in one column — reaction first,
            delivery status beneath it — so both read as marks ON the message
            above rather than a two-column row of unrelated controls. */}
        <Reactions
          rows={reactions}
          mine={mine}
          onToggle={onToggleReaction}
          onOpenReactors={onOpenReactors}
        />
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
  quote,
  onPick,
  onReply,
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
  /** What the lifted message itself answers, so the copy matches the row. */
  quote?: Quote | null;
  onPick: (emoji: string) => void;
  /** Answer this one message. First on the card, ahead of everything else. */
  onReply?: () => void;
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
  // First, ahead of Pin. In a room of six discussing three plans it is the
  // action people reach for most, and the one that makes the thread readable
  // for somebody who arrives an hour late.
  if (onReply) {
    actions.push({ label: 'Reply', run: onReply, destructive: false });
  }
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
          <BubbleBody message={target.message} mine={mine} tailed quote={quote} />
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
 * The line a ROOM wrote about itself, rather than something anybody typed.
 *
 * Read off the row's own `kind`, not from a caller. The kinds have grown —
 * 'joined' was the first, and 20260902200000 adds 'left', 'removed' and
 * 'ends' — and every one of them arrives on the same column through the same
 * RPC. A thread that asked its caller to enumerate them would render the next
 * one as a BUBBLE the person appears to have typed ("Pia was removed",
 * signed by Pia, with her face beside it), which is the exact failure the
 * centred line exists to prevent. `systemFor` still wins where a caller
 * passes one, so the room screen's existing answer is untouched.
 *
 * `kind` is optional because a direct chat reads the `messages` table and its
 * rows predate the column; undefined means an ordinary message.
 */
function systemLine(message: ThreadMessage): string | null {
  const kind = message.kind;
  return kind != null && kind !== 'said' ? (message.body ?? null) : null;
}

/**
 * Who reacted, for the sheet a long press on a chip opens.
 *
 * The list is small by nature — a chip with twelve people behind it is a
 * twelve-person room, not a scroll — so this is a plain column rather than a
 * list, and it is the sheet's own scroller that handles the day somebody
 * proves that wrong.
 */
function ReactorRow({
  name,
  photoPath,
  emoji,
}: {
  name: string | null;
  photoPath: string | null;
  emoji: string;
}) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(photoPath);
  const initial = name?.trim()?.[0]?.toUpperCase() ?? null;
  return (
    <View style={styles.reactorRow}>
      <View style={[styles.reactorFace, { backgroundColor: theme.surfaceSunken }]}>
        {url ? (
          <Image source={{ uri: url }} style={styles.runAvatarImage} contentFit="cover" />
        ) : initial ? (
          <ThemedText type="caption" themeColor="textSecondary" style={styles.runAvatarInitial}>
            {initial}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText style={styles.reactorName} numberOfLines={1}>
        {name ?? 'Traveler'}
      </ThemedText>
      <ThemedText type="footnote">{emoji}</ThemedText>
    </View>
  );
}

function ReactorSheet({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const { data: reactors, isPending, isError } = useReactors(messageId);
  return (
    <Sheet onClose={onClose} scrolls>
      <ThemedText type="title">Who reacted</ThemedText>
      {isPending ? (
        <ActivityIndicator style={styles.loadingMore} />
      ) : isError ? (
        // Not folded into the empty state below. "Nobody reacted" is a claim
        // about the room, and making it because a request failed on hostel
        // wifi is telling somebody something untrue.
        <ThemedText type="footnote" themeColor="textSecondary">
          Could not load who reacted. Close this and open it again.
        </ThemedText>
      ) : (reactors ?? []).length === 0 ? (
        // A reaction taken back between the press and the answer lands here.
        <ThemedText type="footnote" themeColor="textSecondary">
          Nobody on this one any more.
        </ThemedText>
      ) : (
        (reactors ?? []).map((reactor) => (
          <ReactorRow
            key={`${reactor.user_id}-${reactor.emoji}`}
            name={reactor.display_name}
            photoPath={reactor.photo_path}
            emoji={reactor.emoji}
          />
        ))
      )}
    </Sheet>
  );
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
  onReply,
  quoteFor,
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
  onEndReached,
  loadingMore = false,
  unreadFrom,
}: {
  messages: ThreadMessage[];
  ownUserId: string | null;
  /** Whose name goes on "X unsent a message". */
  otherName?: string | null;
  reactions: ReactionSummaryRow[];
  onToggleReaction: (messageId: string, emoji: string, on: boolean) => void;
  /**
   * Answer one message. The caller holds the reply target, because it is the
   * caller that owns the composer the quoted banner appears above.
   */
  onReply?: (messageId: string) => void;
  /**
   * What a message answers, resolved by the caller: a direct chat looks the
   * parent up in the loaded page, a room reads the columns room_messages
   * joins for it.
   */
  quoteFor?: (message: ThreadMessage) => Quote | null;
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
  /**
   * Reaching the oldest loaded message. On an inverted list this fires at the
   * visual TOP, which is exactly where "earlier" is, so a conversation pages
   * backwards by being read rather than by a button.
   */
  onEndReached?: () => void;
  /** A page is on its way. Drawn above whatever footer the caller passed. */
  loadingMore?: boolean;
  /**
   * The oldest message this reader has not seen. The New line is drawn above
   * it, and the thread opens there rather than at the newest message.
   */
  unreadFrom?: string | null;
}) {
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  /**
   * The message whose reactors are on screen, or null.
   *
   * Groups and rooms only, and the discriminator is `avatarFor` — the prop a
   * room passes and a one-to-one chat does not, because a chat with two people
   * in it needs neither faces nor names. No new option defaulted off for
   * somebody to forget to set: the surface that already says "this thread has
   * more than two people in it" says it once, here as well.
   */
  const [reactorsFor, setReactorsFor] = useState<string | null>(null);
  const namesReactors = avatarFor != null;
  const { height: windowHeight } = useWindowDimensions();
  const theme = useTheme();
  const loadingTint = theme.textSecondary;
  const list = useRef<FlatList<ThreadMessage>>(null);
  // The opening jump happens at most once per mount, and never while the
  // keyboard is moving: the thread stands on a keyboard-sized floor and an
  // inverted list is anchored to its own bottom, so a measured scroll taken
  // across a keyboard dismissal is off by a keyboard's height (traps).
  const jumped = useRef(false);
  const laidOut = useRef(false);
  const retriedJump = useRef(false);
  const [pastAScreen, setPastAScreen] = useState(false);

  const jumpToUnread = () => {
    if (jumped.current || !laidOut.current || unreadFrom == null) {
      return;
    }
    const index = messages.findIndex((message) => message.id === unreadFrom);
    // Marked done either way: a boundary too far back to place is a decision,
    // not something to retry on the next layout pass.
    jumped.current = true;
    if (index < 0 || index > UNREAD_JUMP_MAX) {
      return;
    }
    list.current?.scrollToIndex({ index, viewPosition: 0.85, animated: false });
  };

  // Both doors, because neither alone is enough: the list can lay out before
  // the first page arrives (nothing to jump to), and data can arrive without
  // the frame ever changing again (no second onLayout).
  useEffect(jumpToUnread);
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
        ref={list}
        style={styles.flex}
        inverted
        data={messages}
        onLayout={() => {
          laidOut.current = true;
          jumpToUnread();
        }}
        // No getItemLayout and bubbles of every height, so a jump can miss.
        // Land on the estimate, then try the real index once on the next
        // frame, by which time the cells around it have been measured.
        onScrollToIndexFailed={(info) => {
          list.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: false,
          });
          if (retriedJump.current) {
            return;
          }
          retriedJump.current = true;
          requestAnimationFrame(() => {
            list.current?.scrollToIndex({
              index: info.index,
              viewPosition: 0.85,
              animated: false,
            });
          });
        }}
        // Inverted, so the offset GROWS as the reader goes back in time.
        onScroll={(event) => {
          const past = event.nativeEvent.contentOffset.y > windowHeight;
          setPastAScreen((current) => (current === past ? current : past));
        }}
        scrollEventThrottle={16}
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
          const systemOf = (m: ThreadMessage) => systemFor?.(m) ?? systemLine(m);
          const olderIsRun = older != null && systemOf(older) == null;
          const newerIsRun = newer != null && systemOf(newer) == null;
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
          const system = systemOf(item);
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
              {/* Where reading stopped. INSIDE the same wrapper as the
                  bubble, under the day separator and above the author line:
                  an inverted list flips a cell's children, so a line emitted
                  as a sibling marks the boundary against the wrong message
                  (traps). */}
              {item.id === unreadFrom ? (
                <View style={styles.unreadRow}>
                  <View style={[styles.unreadRule, { backgroundColor: theme.highlight }]} />
                  <ThemedText type="caption" style={{ color: theme.highlight }}>
                    New
                  </ThemedText>
                  <View style={[styles.unreadRule, { backgroundColor: theme.highlight }]} />
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
                  quote={quoteFor?.(item) ?? null}
                  reactions={byMessage.get(item.id) ?? []}
                  onToggleReaction={(emoji, on) => onToggleReaction(item.id, emoji, on)}
                  // Never while the long-press menu is up: its own <Modal> is
                  // over the whole screen, and iOS silently drops a
                  // presentation begun while another is dismissing — on Fabric
                  // that does not lose a sheet, it kills touch for the app
                  // (traps). The chip is behind the scrim anyway; this is the
                  // belt.
                  onOpenReactors={
                    namesReactors && !isLocalId(item.id) && menu == null
                      ? () => setReactorsFor(item.id)
                      : undefined
                  }
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
        // 0.4 rather than the default 2: the thread is tall, and firing a
        // page fetch two screens early on a conversation somebody is only
        // scrolling through spends a round trip nobody asked for.
        onEndReachedThreshold={0.4}
        onEndReached={onEndReached}
        // One element, not two: the footer slot is already taken by the
        // caller's anchor card, and an inverted list flips a cell's children
        // (traps), so the spinner and the card have to be ordered inside one
        // view rather than emitted as siblings.
        ListFooterComponent={
          loadingMore || footer ? (
            <View>
              {loadingMore ? (
                <ActivityIndicator style={styles.loadingMore} color={loadingTint} />
              ) : null}
              {footer}
            </View>
          ) : null
        }
      />

      {/* The way back to the bottom, and the escape hatch if the opening jump
          lands somewhere surprising. Shown once the reader is more than a
          screen back, which on an inverted list means a growing offset. */}
      {pastAScreen ? (
        <Animated.View
          entering={FadeIn.duration(120)}
          style={styles.jumpWrap}
          pointerEvents="box-none">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Jump to the latest message"
            haptic="light"
            scaleTo={0.96}
            onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })}
            style={[styles.jump, Elevation.floating, { backgroundColor: theme.surface }]}>
            <SymbolView
              name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }}
              size={13}
              tintColor={theme.text}
            />
            <ThemedText type="footnote">Jump to latest</ThemedText>
          </PressableScale>
        </Animated.View>
      ) : null}

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
            quote={quoteFor?.(menu.message) ?? null}
            onReply={
              // Not for a message that has been taken back or taken down, and
              // not for a reader with no composer: an action that cannot be
              // carried out is worse than one that was never offered.
              onReply
                ? () => {
                    const id = menu.message.id;
                    setMenu(null);
                    onReply(id);
                  }
                : undefined
            }
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

      {/* Its own Sheet rather than a row inside the message menu: the menu is
          a raw <Modal>, and presenting the sheet's Modal out of it is exactly
          the collision above. Opened from the thread, there is nothing to
          collide with. */}
      {reactorsFor ? (
        <ReactorSheet messageId={reactorsFor} onClose={() => setReactorsFor(null)} />
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
  quote: {
    borderLeftWidth: 2,
    paddingLeft: Space.sm,
    marginBottom: 2,
    gap: 1,
  },
  planCard: {
    // Logical, not physical: this rule is new, so there is no reason for it to
    // start out unable to mirror itself in a right-to-left locale. The quote
    // strip above it is grandfathered, not a precedent.
    borderStartWidth: 2,
    paddingStart: Space.sm,
    marginBottom: Space.xs,
    gap: Space.xs,
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  planText: {
    // The words take whatever is left after the glyph, so a long venue name
    // wraps inside the bubble instead of pushing the glyph off it.
    flex: 1,
    gap: 1,
  },
  planJoin: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    paddingHorizontal: Space.md,
    paddingVertical: Space.xs,
  },
  reactorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: HitTarget,
  },
  reactorFace: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactorName: {
    flex: 1,
  },
  loadingMore: {
    paddingVertical: Space.md,
  },
  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingTop: Space.lg,
    paddingBottom: Space.sm,
  },
  unreadRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  jumpWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Space.md,
    alignItems: 'center',
  },
  jump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    minHeight: HitTarget,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.pill,
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
