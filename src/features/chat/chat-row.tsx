import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space, Spacing, Type } from '@/constants/theme';
import { useIsPlaceChat } from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
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
    (isRoom && chat.member_count != null && chat.member_count > 0
      ? `${countOf(chat.member_count, 'person', 'people')} in this chat` +
        (leaveOn
          ? ` · you leave ${leaveOn.toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'short',
            })}`
          : '')
      : null);

  return (
    <View style={styles.row}>
      {/* iMessage's leading gutter. The dot lives OUTSIDE the text column, so
          the whole list can be scanned for what is waiting without reading a
          single word of it. */}
      <View style={styles.unreadGutter}>
        {unread ? <View style={[styles.unreadDot, { backgroundColor: theme.highlight }]} /> : null}
      </View>
      {isRoom ? (
        <View style={[styles.roomBadge, { backgroundColor: theme.accentSoft }]}>
          {/* A house, not a group of figures. `kind === 'room'` covers a
              hostel's own guest room as well as a travelers' group, and a
              business room under three little people would be wrong about
              what it is. */}
          <SymbolView
            name={{ ios: 'house.fill', android: 'home', web: 'home' }}
            size={22}
            tintColor={theme.accent}
          />
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
        </View>
        <ThemedText
          type="callout"
          themeColor={unread ? 'text' : 'textSecondary'}
          numberOfLines={2}
          style={[styles.rowPreview, { height: previewHeight }]}>
          {preview ?? ''}
        </ThemedText>
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

/** One button behind a swiped row. */
export function SwipeAction({
  label,
  icon,
  tint,
  onPress,
}: {
  label: string;
  icon: SymbolViewProps['name'];
  tint: string;
  onPress: () => void;
}) {
  const theme = useTheme();
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
      <SymbolView name={icon} size={18} tintColor={theme.onAccent} />
      <ThemedText type="caption" style={{ color: theme.onAccent }}>
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
