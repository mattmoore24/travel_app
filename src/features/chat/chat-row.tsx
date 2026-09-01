import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, Spacing, Type } from '@/constants/theme';
import { useIsPlaceChat } from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { planChipLabel, privacyTail, roomBadgeGlyph } from '@/features/chat/row-kind';
import { rowTimestamp, unreadLabel } from '@/features/chat/separators';
import { finiteDate } from '@/features/groups/closing';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { countOf } from '@/lib/plural';
import type { ChatListRow } from '@/lib/database.types';

/**
 * The conversation row, shared by every screen that lists conversations —
 * the inbox and the archive. It was lifted out of src/app/(tabs)/chat.tsx
 * unchanged so the two screens cannot diverge again: Archived had kept the
 * floating-card layout the inbox was deliberately rebuilt away from, and
 * with it lost the avatar, the timestamp, the unread dot and the room
 * distinction.
 */

/**
 * The conversation-row avatar, at the size the messaging apps converged on.
 *
 * With the 16pt leading inset and the 12pt gap after it, this puts the text
 * column at x=80 — and the row separator starts there too, which is what
 * makes a list of avatars read as one column rather than as stacked cards.
 */
export const AVATAR = 52;

export function Avatar({ path, size = 48 }: { path: string | null; size?: number }) {
  const theme = useTheme();
  const { data: url } = usePhotoUrl(path);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: theme.backgroundSelected,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
      ) : (
        <SymbolView
          name={{ ios: 'person.fill', android: 'person', web: 'person' }}
          size={size / 2}
          tintColor={theme.textSecondary}
        />
      )}
    </View>
  );
}

/** The same circle, signed against the bucket a place's photos actually live in. */
export function PlaceAvatar({ path, size = 48 }: { path: string | null; size?: number }) {
  const theme = useTheme();
  const { data: url } = useBusinessPhotoUrl(path);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: theme.backgroundSelected,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
      ) : (
        <SymbolView
          name={{ ios: 'storefront.fill', android: 'storefront', web: 'storefront' }}
          size={size / 2}
          tintColor={theme.textSecondary}
        />
      )}
    </View>
  );
}

/**
 * And again, signed against the bucket a GROUP's own picture lives in.
 *
 * Three buckets, three hooks, and the reason is a bug this row has already
 * paid for: a path signed through the wrong one comes back a 404 wearing a
 * perfectly valid URL, so the row silently falls back to a glyph and nobody
 * can tell a missing photo from a mis-signed one.
 */
export function GroupAvatar({ path, size = 48 }: { path: string | null; size?: number }) {
  const theme = useTheme();
  const { data: url } = useChatPhotoUrl(path);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        overflow: 'hidden',
        backgroundColor: theme.backgroundSelected,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {url ? (
        <Image source={{ uri: url }} style={styles.fill} contentFit="cover" />
      ) : (
        <SymbolView
          name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
          size={size / 2}
          tintColor={theme.textSecondary}
        />
      )}
    </View>
  );
}

/**
 * The preview block is pinned to this many lines so the list stays scannable by
 * position rather than reflowing as messages arrive. It is spent as
 * `PREVIEW_LINES * Type.callout.lineHeight * fontScale` at every call site: the
 * unscaled product is 40, which is EXACTLY two lines at the default text size,
 * so without the reader's own scale the second line clips at the first Dynamic
 * Type step above default. Do not shave it.
 */
export const PREVIEW_LINES = 2;

/** Two preview lines at the reader's text size, not at the default one. */
export function usePreviewHeight() {
  const { fontScale } = useWindowDimensions();
  return PREVIEW_LINES * Type.callout.lineHeight * fontScale;
}

/**
 * One conversation, drawn the way the messaging apps people already use draw
 * one.
 *
 * These used to be separate filled cards floating on the canvas with 16pt of
 * air between them, which is a layout for a feed of unrelated things — and a
 * list of conversations is the opposite of that. Flush rows on one surface,
 * separated by a hairline that starts where the text starts, is what iMessage,
 * WhatsApp, Telegram and Signal all settled on, and it is what makes a list
 * scannable: the eye runs down a single column of names instead of stepping
 * over a card edge every 80 points.
 *
 * The height is FIXED — two preview lines are always reserved, whether or not
 * there are two — for the same reason. A list whose rows change height as
 * messages come and go cannot be scanned by position, and the ragged right
 * edge of the timestamps is what everybody complains about without being able
 * to name.
 */
export function ChatRow({ chat, last = false }: { chat: ChatListRow; last?: boolean }) {
  const previewHeight = usePreviewHeight();
  const theme = useTheme();
  const isRoom = chat.kind === 'room';
  // A conversation with a BUSINESS carries the business's cover photo, which
  // lives in a different bucket. Signed through the profile hook it comes back
  // a 404 wearing a valid-looking URL, so the row fell back to a person glyph
  // for a bar — and on the business's own side of the same row, where the
  // photo is the TRAVELER's, it did the reverse. See useIsPlaceChat.
  const isPlace = useIsPlaceChat(chat.kind);
  const unread = chat.unread_count > 0;
  // A room is created with the listing, so `created_at` is when the business
  // registered, not when anybody spoke. Falling back to it stamped an empty
  // room with a time, and the row then said three things that could not all be
  // true at once: a timestamp, a zero member count, and "No messages yet"
  // below. The fallback stays right for a direct chat, where created_at IS the
  // first message. rowTrailing already guards on an empty string.
  const stamp =
    isRoom && chat.last_message_at == null
      ? ''
      : rowTimestamp(chat.last_message_at ?? chat.created_at);
  const closed = chat.chat_status !== 'active';
  // A group with nothing said in it yet has no preview to show, so the row
  // says who is in it instead of sitting empty. Once somebody writes, the
  // message wins: the member count is on the group's own screen, and a third
  // line of metadata under every row is exactly the clutter this layout
  // exists to remove.
  // `expires_at` is NOT NULL on the server, so the admin of a chat with no
  // end date holds an infinite seat and PostgREST sends the string
  // "infinity" — truthy, and `new Date` of it is Invalid Date.
  const leaveOn = isRoom ? finiteDate(chat.expires_at) : null;
  const preview =
    chat.last_message ??
    chat.first_message ??
    (isRoom && chat.member_count != null
      ? // Zero says what My business says about the same room. Two screens
        // describing one first day in two voices ("0 people here" against
        // "Nobody in yet") read as two facts.
        (chat.member_count > 0
          ? `${countOf(chat.member_count, 'person', 'people')} in this chat`
          : 'Nobody in yet') +
        (leaveOn
          ? ` · you leave ${leaveOn.toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}`
          : '')
      : null);
  // Who else can open this. Three rows with three privacy models used to look
  // identical, and the one that matters is the plan: post_joinable_pin opens
  // it with speaking = 'everyone', so a crew you think is four people is
  // whoever can see the pin.
  const tail = privacyTail(chat);
  // NOT concatenated onto the preview. The preview is two clamped lines in a
  // fixed-height box, roughly sixty characters, so any message longer than
  // about thirty clipped the tail clean off — and the row it clips it off is
  // exactly the one the tail exists for, a plan room with conversation in it.
  // It gets a line of its own, because it is a fact about the ROOM rather
  // than about the last thing said in it.
  const previewLine = preview;
  // A plan's day used to vanish the instant anybody wrote in the room, because
  // the preview falls through to the last message. The day is the whole reason
  // the room exists, so it gets its own mark on the title line and stops
  // competing with the message for the same line of text.
  const planDay = planChipLabel(chat.plan_date);
  const roomGlyph = roomBadgeGlyph(chat);

  return (
    <View style={styles.row}>
      {/* iMessage's leading gutter. The dot lives OUTSIDE the text column, so
          the whole list can be scanned for what is waiting without reading a
          single word of it. */}
      <View style={styles.unreadGutter}>
        {unread ? <View style={[styles.unreadDot, { backgroundColor: theme.highlight }]} /> : null}
      </View>
      {isRoom && chat.photo_path ? (
        // A group that chose a picture gets to show it. my_chats returns
        // `g.photo_path`, which only a traveler group ever has — a business
        // room has no groups row, so this branch cannot reach for a cover in
        // the wrong bucket and come back a 404 wearing a valid URL.
        <GroupAvatar path={chat.photo_path} size={AVATAR} />
      ) : isRoom ? (
        <View style={[styles.roomBadge, { backgroundColor: theme.accentSoft }]}>
          {/* Three marks, not one house. The old note here defended one glyph
              for two KINDS, and it was right about the thing it objected to:
              nobody is putting three little people on a hostel. What the list
              actually had was one glyph for three PRIVACY MODELS — a private
              crew, a plan any stranger who can see the pin walks into, and a
              room a signed-out visitor can read — and the plan, the one row
              that is about to become residue, looked as permanent as the
              hostel. So the business keeps a business mark (the storefront the
              map and PlaceAvatar already use for one), the plan takes the
              marker the person tapped to get in, and only a travelers' group
              is drawn as people. */}
          <SymbolView name={roomGlyph} size={22} tintColor={theme.accent} />
        </View>
      ) : isPlace ? (
        <PlaceAvatar path={chat.photo_path} size={AVATAR} />
      ) : (
        <Avatar path={chat.photo_path} size={AVATAR} />
      )}
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>
          <ThemedText
            type="body"
            style={[styles.rowName, unread ? styles.rowNameUnread : styles.rowNameRead]}
            numberOfLines={1}>
            {chat.title ?? 'Traveler'}
          </ThemedText>
          {chat.pinned ? (
            <SymbolView
              name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
              size={11}
              tintColor={theme.textSecondary}
            />
          ) : null}
          {chat.muted ? (
            <SymbolView
              name={{
                ios: 'bell.slash.fill',
                android: 'notifications_off',
                web: 'notifications_off',
              }}
              size={11}
              tintColor={theme.textSecondary}
            />
          ) : null}
          {planDay ? (
            <View style={[styles.planChip, { backgroundColor: theme.surfaceSunken }]}>
              {/* Clamped and shrinkable. At the largest accessibility sizes an
                  unclamped date took ~170pt of a ~230pt title row and left the
                  name as three characters — and the name is the thing the
                  column is scanned for. The day is also in the tail below in
                  words, so losing some of it here costs nothing. */}
              <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
                {planDay}
              </ThemedText>
            </View>
          ) : null}
        </View>
        {/* One reserved box for both lines, so a row with a privacy tail is
            exactly as tall as one without and the list does not jump as rows
            arrive. The tail takes the second line when there is one; without
            it the preview keeps both. */}
        <View style={{ height: previewHeight }}>
          <ThemedText
            type="callout"
            themeColor={unread ? 'text' : 'textSecondary'}
            numberOfLines={tail ? 1 : 2}
            style={styles.rowPreview}>
            {previewLine}
          </ThemedText>
          {tail ? (
            <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
              {tail}
            </ThemedText>
          ) : null}
        </View>
      </View>
      {/* Stretched and top-aligned, so the stamp sits on the name's line
          while the avatar stays centred against the whole row. */}
      <View style={styles.rowTrailing}>
        {stamp ? (
          <ThemedText type="footnote" themeColor={unread ? 'highlight' : 'textSecondary'}>
            {stamp}
          </ThemedText>
        ) : null}
        {/* The dot already said "unread". This says how much, and only when
            that is worth a pill: the RPC counts human messages that have
            cleared moderation and nothing else. */}
        {chat.unread_count > 1 ? (
          <View style={[styles.unreadPill, { backgroundColor: theme.highlight }]}>
            <ThemedText type="caption" style={[styles.unreadCount, { color: theme.background }]}>
              {unreadLabel(chat.unread_count)}
            </ThemedText>
          </View>
        ) : null}
        {closed ? (
          <ThemedText type="caption" themeColor="textSecondary">
            Closed
          </ThemedText>
        ) : null}
      </View>
      {/* Inset to the text column, which is the whole trick: a full-width
          rule chops the list into slabs, an inset one threads the avatars
          together into a single column. */}
      {last ? null : <View style={[styles.separator, { backgroundColor: theme.hairline }]} />}
    </View>
  );
}

/**
 * One button behind a swiped row.
 *
 * `onTint` exists because the content used to be hardcoded to `onAccent`, a
 * near-black that is only legible on the two light fills. Any other fill and
 * the button went dark-on-dark, so the fill could never change - which is how
 * Archive ended up painted in danger red, the one colour that DID work with
 * black on it. The pair travels together now.
 */
export function SwipeAction({
  label,
  icon,
  tint,
  onTint,
  onPress,
}: {
  label: string;
  icon: SymbolViewProps['name'];
  tint: string;
  /** The colour the icon and label are drawn in, ON `tint`. */
  onTint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.swipeAction,
        { backgroundColor: tint },
        pressed && styles.pressed,
      ]}>
      <SymbolView name={icon} size={18} tintColor={onTint} />
      <ThemedText type="caption" style={{ color: onTint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  /* Cancels the scroller's own 24pt gutter so the rows and their separators
     run edge to edge, then each row pads itself back in. Everything else on
     the screen keeps the gutter — a screen whose scroller pads a different
     amount must cancel ITS own gutter, not this one. */
  list: {
    marginHorizontal: -Spacing.four,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  roomBadge: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  /* The name gives way first, so a long one truncates rather than pushing
     the timestamp off the end of the row. */
  rowName: {
    flexShrink: 1,
  },
  /* Quiet on purpose. The day is a fact about the plan, not a call to act on
     it, and an accent pill on a list row would out-shout the unread mark that
     is the only thing this column is scanned for. */
  planChip: {
    flexShrink: 1,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
  },
  /* Semibold read, bold unread. The weight change is the second signal after
     the dot, and it is the one that survives a colourblind eye. */
  rowNameRead: {
    fontWeight: '600',
  },
  rowNameUnread: {
    fontWeight: '700',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  unreadPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadCount: {
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingLeft: Space.lg,
    paddingRight: Space.lg,
    paddingVertical: Space.sm,
  },
  /* Outside the text column on purpose: the whole list can be scanned for
     what is waiting without reading a word of it. Fixed width whether or not
     there is a dot in it, so every name in the list starts at the same x. */
  unreadGutter: {
    width: 10,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  /* Always two lines tall, whether or not there are two. A list whose rows
     change height as messages arrive cannot be scanned by position, and the
     ragged column of timestamps is what reads as "ugly" without anybody
     being able to name it.

     40 is 2 x Type.callout.lineHeight (20) with NO slack, so the base must be
     multiplied by the reader's fontScale at every call site or the second line
     clips at the first Dynamic Type step above default. Do not shave it. */
  rowPreview: {
    height: PREVIEW_LINES * Type.callout.lineHeight,
  },
  /* Stretched, so the stamp sits on the name's line while the avatar stays
     centred against the whole row. */
  rowTrailing: {
    alignSelf: 'stretch',
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
    gap: Space.xs,
    paddingTop: 2,
  },
  /* Starts where the text starts. A full-width rule chops the list into
     slabs; an inset one threads the avatars into a single column. */
  separator: {
    position: 'absolute',
    left: Space.lg + 10 + Space.md,
    right: 0,
    bottom: 0,
    height: StyleSheet.hairlineWidth,
  },
  /* Flush and square, like the rows they slide out from. Rounded pills with
     gaps between them belonged to the card layout; against a continuous list
     they read as three buttons that fell out of it. */
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  swipeAction: {
    width: 74,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pressed: {
    opacity: 0.7,
  },
});

export { styles as rowStyles };
