import { router, useFocusEffect } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import { Alert, RefreshControl, ScrollView, SectionList, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { AvatarButton } from '@/components/ui/avatar-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Segmented } from '@/components/ui/segmented';
import { FormTextField } from '@/components/form/form-text-field';
import { filterChats, SEARCH_APPEARS_AT } from '@/features/chat/search';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useOwnBusiness } from '@/features/business/hooks';
import {
  AVATAR,
  Avatar,
  ChatRow,
  SwipeAction,
  rowStyles,
  usePreviewHeight,
} from '@/features/chat/chat-row';
import { InviteCodeSheet } from '@/features/chat/invite-code-sheet';
import { useArchiveNotice } from '@/features/chat/archive-notice';
import { useIsGuest } from '@/features/guest/hooks';
import { useAnnounce } from '@/features/chat/use-announce';
import { useBrowsingCity } from '@/features/pins/browsing-city';
import { useLiveChatList } from '@/features/chat/hooks';
import { rowTimestamp } from '@/features/chat/separators';
import { waitingInSegment } from '@/features/chat/unread';
import { useChatPref, useCityRooms } from '@/features/rooms/hooks';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import { HitTarget, MaxContentWidth, Motion, Radius, Spacing } from '@/constants/theme';
import { useIncomingRequests, useMyChats, useSentRequests } from '@/features/matching/hooks';
import { IncomingRequestCard } from '@/features/matching/incoming-request-card';
import { waitingRows } from '@/features/matching/sent-rows';
import { usePublicPhotos, usePublicProfile } from '@/features/profile/hooks';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { countOf } from '@/lib/plural';
import type {
  ChatListRow,
  CityRoomRow,
  IncomingRequestRow,
  SentRequestRow,
} from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * A hello you sent that has not turned into a chat yet.
 *
 * The sender's half of the loop, and the only reason it exists: before this
 * a first message left no trace anywhere in the app. You wrote something,
 * the screen closed, and there was nowhere to check what you had said or
 * even to whom.
 *
 * What it must NEVER show is whether the other person declined, read it, or
 * had it stopped by moderation. The RPC already collapses all three into a
 * flat 'sent' (rules 4 and 5), and this row keeps that promise: one label,
 * unchanging, until it becomes a real conversation.
 */
function SentHelloRow({ request, last = false }: { request: SentRequestRow; last?: boolean }) {
  const previewHeight = usePreviewHeight();
  const theme = useTheme();
  const { data: profile } = usePublicProfile(request.recipient_id);
  const { data: photos = [] } = usePublicPhotos(request.recipient_id);
  const photoPath = photos.find((p) => p.position === 0)?.storage_path ?? null;
  const name = profile?.display_name ?? 'Traveler';
  // Stopped by the classifier AFTER this screen had already said it was on
  // its way. The row used to disappear on the next refetch, which meant the
  // app confirmed a message and then deleted the only copy of it - and a
  // first message is one shot per pair for ever, so there was no way back.
  // This is the sender's own text and our own moderation of it, so saying so
  // reveals nothing about the person it was aimed at.
  const notDelivered = request.state === 'blocked' && request.blocked_after_send;

  // The same row geometry as a conversation, quieter. A hello with no answer
  // is not a chat yet — tapping it opens a profile, not a thread — so the
  // avatar is smaller, the name is not bold, and the trailing word says what
  // state it is in rather than when it happened.
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        notDelivered ? `Your message to ${name} was not delivered` : `You said hi to ${name}`
      }
      accessibilityHint={
        notDelivered ? 'Opens the message so you can rewrite it' : 'Opens their profile'
      }
      scaleTo={0.99}
      onPress={() =>
        notDelivered
          ? router.push({
              pathname: '/compose-request',
              params: {
                userId: request.recipient_id,
                name,
                photoPath: photoPath ?? '',
                source: request.source,
                element: request.profile_element ?? 'trip',
                // The whole reason the retry is cheap: the composer prefills
                // from `draft`, so nothing anybody wrote has to be typed
                // twice.
                draft: request.first_message,
                // So the composer can say the two things a rewriter cannot
                // guess: it gets screened again, and it spends one of today's.
                retry: '1',
              },
            })
          : router.push(`/profile/${request.recipient_id}`)
      }>
      <View style={rowStyles.row}>
        <View style={rowStyles.unreadGutter} />
        <Avatar path={photoPath} size={AVATAR - 8} />
        <View style={rowStyles.rowBody}>
          <ThemedText type="body" style={rowStyles.rowNameRead} numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText
            type="callout"
            themeColor="textSecondary"
            numberOfLines={2}
            style={[rowStyles.rowPreview, { height: previewHeight }]}>
            You: {request.first_message}
          </ThemedText>
        </View>
        <View style={rowStyles.rowTrailing}>
          {/* WHEN, not what became of it. The row used to print a fixed
              "Sent", so a hello from three weeks ago in a city you have left
              looked exactly as live as one from an hour ago - and that is
              the one thing this column may say. It is the conversation
              rows' own helper, so the vocabulary matches the list it sits
              in.

              The rule it must keep is about the RECIPIENT, not about status
              in general: this column may never reveal a read, a decline, or
              anything the person written to did. It may say the one thing
              that is entirely the sender's own business — that their own
              message never left — because a hello stopped by the classifier
              is news the sender needs and news the recipient never had. So:
              a time, or 'Not delivered', and nothing else ever. */}
          <ThemedText type="footnote" themeColor={notDelivered ? 'warning' : 'textSecondary'}>
            {notDelivered ? 'Not delivered' : rowTimestamp(request.created_at)}
          </ThemedText>
        </View>
        {last ? null : <View style={[rowStyles.separator, { backgroundColor: theme.hairline }]} />}
      </View>
    </PressableScale>
  );
}

/**
 * A row that is not a conversation, in a conversation's geometry.
 *
 * "Have an invite?", "Archived" and the rooms near you used to be filled
 * cards sitting among flush rows, which is the half-and-half the founder was
 * still looking at after the list itself was fixed: one column of rows
 * interrupted by three floating slabs. iMessage has no such thing anywhere on
 * that screen, and neither does anything else people use.
 *
 * They are the same row now. What separates a destination from a conversation
 * is the chevron and the quieter glyph, not a different container.
 */
function PlainRow({
  title,
  detail,
  glyph,
  tint,
  chevron = false,
  last = false,
  accessibilityLabel,
  onPress,
}: {
  title: string;
  detail: string;
  glyph: SymbolViewProps['name'];
  /** 'accent' for a place you can go into, 'quiet' for a destination. */
  tint?: 'accent' | 'quiet';
  chevron?: boolean;
  last?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const previewHeight = usePreviewHeight();
  const theme = useTheme();
  const accented = tint !== 'quiet';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      haptic="light"
      scaleTo={0.995}
      onPress={onPress}>
      <View style={rowStyles.row}>
        <View style={rowStyles.unreadGutter} />
        <View
          style={[
            rowStyles.roomBadge,
            { backgroundColor: accented ? theme.accentSoft : theme.surfaceSunken },
          ]}>
          <SymbolView
            name={glyph}
            size={22}
            tintColor={accented ? theme.accent : theme.textSecondary}
          />
        </View>
        <View style={rowStyles.rowBody}>
          <ThemedText type="body" style={rowStyles.rowNameRead} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText
            type="callout"
            themeColor="textSecondary"
            numberOfLines={2}
            style={[rowStyles.rowPreview, { height: previewHeight }]}>
            {detail}
          </ThemedText>
        </View>
        {chevron ? (
          <View style={rowStyles.rowTrailing}>
            <SymbolView
              name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              size={13}
              tintColor={theme.textSecondary}
            />
          </View>
        ) : null}
        {last ? null : <View style={[rowStyles.separator, { backgroundColor: theme.hairline }]} />}
      </View>
    </PressableScale>
  );
}

/**
 * "3 quiet chats moved to Archived", once, above the inbox.
 *
 * archive_idle_chats runs at 03:30 and moves any chat with nothing said in it
 * for fourteen days. The window is right - an inbox that never prunes itself
 * becomes a wall of dead conversations, and archiving is genuinely
 * reversible. What was wrong was that it happened in silence, so somebody
 * hunting for a name found nothing and had no reason to think the app still
 * had it.
 *
 * One line, dismissible, and reading it is what marks it read. Tapping goes
 * where the chats went.
 */
function ArchiveNotice({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.notice, { backgroundColor: theme.surfaceSunken }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${countOf(count, 'quiet chat')} moved to Archived. Open Archived.`}
        haptic="light"
        scaleTo={0.995}
        style={styles.noticeBody}
        onPress={() => {
          onDismiss();
          router.push('/archived-chats');
        }}>
        <SymbolView
          name={{ ios: 'archivebox.fill', android: 'archive', web: 'archive' }}
          size={16}
          tintColor={theme.textSecondary}
        />
        <ThemedText type="footnote" style={styles.noticeText}>
          {countOf(count, 'quiet chat')} moved to Archived
        </ThemedText>
      </PressableScale>
      {/* Its own target rather than a corner of the row: at 44pt it is the
          smallest thing on this screen anybody has to hit deliberately. */}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        haptic="light"
        scaleTo={0.92}
        style={styles.noticeClose}
        onPress={onDismiss}>
        <SymbolView
          name={{ ios: 'xmark', android: 'close', web: 'close' }}
          size={13}
          tintColor={theme.textSecondary}
        />
      </PressableScale>
    </View>
  );
}

/**
 * From this many waiting first messages on, they stop being decisions and
 * become a wall. One or two belong in the inbox; three is already a stack of
 * cards standing between a returning traveler and the conversations they
 * came back for.
 */
const WAITING_COLLAPSE_AT = 3;

/** Big enough to recognise a face at, small enough for a list row. */
const FACE = 32;

/**
 * The whole waiting pile as one row: the faces, the count, and a way in.
 *
 * Deliberately a row and not a badge. A number alone says how much work is
 * waiting; three faces say who it is from, which is the only thing that
 * makes anybody tap.
 */
function WaitingOnYouRow({ requests }: { requests: IncomingRequestRow[] }) {
  const previewHeight = usePreviewHeight();
  const theme = useTheme();
  const faces = requests.slice(0, 3);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Read the ${countOf(requests.length, 'first message')} waiting on you`}
      haptic="light"
      scaleTo={0.995}
      onPress={() => router.push('/first-messages')}>
      <View style={rowStyles.row}>
        <View style={rowStyles.unreadGutter} />
        {/* Overlapped with a negative margin rather than absolute offsets:
            an absolutely-positioned child resolves against its parent's box,
            and this one has to keep its intrinsic width so the text column
            starts where every other row's does. */}
        <View style={styles.faceStack}>
          {faces.map((request, i) => (
            <View
              key={request.id}
              style={[styles.face, i > 0 && styles.faceOverlap, { borderColor: theme.background }]}>
              <Avatar path={request.photo_path} size={FACE} />
            </View>
          ))}
        </View>
        <View style={rowStyles.rowBody}>
          <ThemedText type="body" style={rowStyles.rowNameRead} numberOfLines={1}>
            {countOf(requests.length, 'first message')}
          </ThemedText>
          <ThemedText
            type="callout"
            themeColor="textSecondary"
            numberOfLines={2}
            style={[rowStyles.rowPreview, { height: previewHeight }]}>
            Read them and answer when you are ready.
          </ThemedText>
        </View>
        <View style={rowStyles.rowTrailing}>
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={13}
            tintColor={theme.textSecondary}
          />
        </View>
      </View>
    </PressableScale>
  );
}

/**
 * Rooms a signed-out visitor (or a signed-in non-member) can look inside.
 *
 * The heading NAMES the city instead of claiming "near you": the app never
 * knows where anybody is (§7 rule 2), and the old heading was also plainly
 * false — it listed whatever city came first in the launch table. The counts
 * are chat membership, not presence, and the words say so.
 *
 * The query lives in ChatScreen (same key, no extra round trip) so the empty
 * card above can tell the truth about whether there is anything to join.
 */
function RoomDiscovery({
  cityName,
  rooms,
  query,
}: {
  cityName: string | null;
  rooms: CityRoomRow[];
  query: { isError: boolean; error: unknown; refetch: () => void };
}) {
  // A failed fetch used to be pixel-identical to a roomless city: the null
  // return below swallowed both.
  if (query.isError) {
    return <LoadError compact what="the open rooms" error={query.error} onRetry={query.refetch} />;
  }
  if (rooms.length === 0) {
    return null;
  }
  return (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
        {cityName ? `Rooms in ${cityName}` : 'Open rooms'}
      </ThemedText>
      <View style={rowStyles.list}>
        {rooms.map((room, i) => (
          <PlainRow
            key={room.chat_id}
            title={room.name}
            detail={
              // Same words My business uses about the same empty room.
              room.member_count > 0
                ? `${countOf(room.member_count, 'person', 'people')} in this chat`
                : 'Nobody in yet'
            }
            // RoomDiscovery lists businesses and nothing else, so it draws
            // the mark the map and the row already use for one. The house it
            // replaced was the same glyph a private crew got, on the one
            // screen where the difference decides what somebody types.
            glyph={{ ios: 'storefront.fill', android: 'storefront', web: 'storefront' }}
            last={i === rooms.length - 1}
            onPress={() => router.push(`/room/${room.chat_id}`)}
          />
        ))}
      </View>
    </>
  );
}

/** A row plus its long-press actions — pin, mute, archive (docs/DESIGN.md). */
function ChatRowLink({
  chat,
  last = false,
  registerSwipe,
}: {
  chat: ChatListRow;
  last?: boolean;
  /**
   * Hands the row's swipeable to the list, which closes it when the row
   * scrolls out of sight. A swiped-open row left behind in a virtualized list
   * is the classic pairing bug, and it is worse here than usual because the
   * action behind the swipe archives a conversation.
   */
  registerSwipe?: (chatId: string, swipeable: SwipeableMethods | null) => void;
}) {
  const theme = useTheme();
  const pref = useChatPref();
  const swipe = useRef<SwipeableMethods>(null);
  // Unread first, because it is the one state that decides whether somebody
  // opens the row. The dot and the pill say it in pixels and say it to
  // nobody using VoiceOver, which is exactly who has the most to lose from a
  // list that will not tell them which conversation is waiting.
  const state = [
    chat.unread_count > 0 ? countOf(chat.unread_count, 'new message') : null,
    chat.pinned ? 'pinned' : null,
    chat.muted ? 'muted' : null,
  ].filter(Boolean);

  const act = (patch: { pinned?: boolean; muted?: boolean; archived?: boolean }) => {
    swipe.current?.close();
    haptics.light();
    pref.mutate({ chatId: chat.chat_id, ...patch });
  };

  const row = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        state.length > 0
          ? `${chat.title ?? 'Conversation'}, ${state.join(', ')}`
          : (chat.title ?? 'Conversation')
      }
      // Pin, mute and archive live behind a long press, which announces
      // itself to nobody. A hint is how VoiceOver is told there is more here.
      accessibilityHint="Press and hold for pin, mute and archive"
      // Barely any: a flush row that shrinks pulls away from the rows above
      // and below it, and the gap that opens is the exact seam this layout
      // exists to close. The press tint carries it instead.
      scaleTo={0.995}
      onPress={() =>
        router.push(chat.kind === 'room' ? `/room/${chat.chat_id}` : `/chat/${chat.chat_id}`)
      }
      onLongPress={() =>
        Alert.alert(chat.title ?? 'Conversation', undefined, [
          {
            text: chat.pinned ? 'Unpin' : 'Pin to top',
            onPress: () => pref.mutate({ chatId: chat.chat_id, pinned: !chat.pinned }),
          },
          {
            text: chat.muted ? 'Unmute' : 'Mute',
            onPress: () => pref.mutate({ chatId: chat.chat_id, muted: !chat.muted }),
          },
          {
            text: 'Archive',
            onPress: () => pref.mutate({ chatId: chat.chat_id, archived: true }),
          },
          { text: 'Cancel', style: 'cancel' },
        ])
      }>
      <ChatRow chat={chat} last={last} />
    </PressableScale>
  );

  return (
    // Swipe is how every messaging app people already use exposes these, and
    // it is a hint rather than a replacement: the long press stays, because a
    // swipe announces itself to VoiceOver even less than a long press does.
    <ReanimatedSwipeable
      ref={(instance) => {
        swipe.current = instance;
        registerSwipe?.(chat.chat_id, instance);
      }}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={rowStyles.swipeActions}>
          <SwipeAction
            label={chat.pinned ? 'Unpin' : 'Pin'}
            icon={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
            tint={theme.accent}
            onTint={theme.onAccent}
            onPress={() => act({ pinned: !chat.pinned })}
          />
          {/* A filled control, not a greyed one. textSecondary is a text
              colour, and as a fill it read as the disabled state of a button
              rather than as a button - the exact thing opacity cannot express
              either. surfaceSunken with text on it is 8.2:1 and reads as a
              control that works. */}
          <SwipeAction
            label={chat.muted ? 'Unmute' : 'Mute'}
            icon={
              chat.muted
                ? { ios: 'bell.fill', android: 'notifications', web: 'notifications' }
                : { ios: 'bell.slash.fill', android: 'notifications_off', web: 'notifications_off' }
            }
            tint={theme.surfaceSunken}
            onTint={theme.text}
            onPress={() => act({ muted: !chat.muted })}
          />
          {/* Not red. The app says twice that archiving is reversible ("still
              readable" on the Archived row, and a new message brings a chat
              back), and then painted the action in the same danger red as
              Unsend and Block, in the rightmost slot iOS has trained thumbs
              to read as delete. Red means this takes something away; if it
              means everything it means nothing. White on accentDeep is
              8.2:1. */}
          <SwipeAction
            label="Archive"
            icon={{ ios: 'archivebox.fill', android: 'archive', web: 'archive' }}
            tint={theme.accentDeep}
            onTint={theme.onAccentDeep}
            onPress={() => act({ archived: true })}
          />
        </View>
      )}>
      {row}
    </ReanimatedSwipeable>
  );
}

/**
 * The room a business runs, in its own inbox.
 *
 * Not a `ChatRowLink`: pin and archive are traveler housekeeping for a list
 * of many conversations, and in a section that holds exactly one row they are
 * two controls that change nothing anybody can see. Mute is real — the owner
 * of a busy room has a reason to want it quiet — so mute is what is here.
 */
function OwnRoomRow({ chat }: { chat: ChatListRow }) {
  const pref = useChatPref();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        chat.unread_count > 0
          ? `${chat.title ?? 'Your room'}, ${countOf(chat.unread_count, 'new message')}`
          : (chat.title ?? 'Your room')
      }
      accessibilityHint="Press and hold to mute"
      scaleTo={0.995}
      onPress={() => router.push(`/room/${chat.chat_id}`)}
      onLongPress={() =>
        Alert.alert(chat.title ?? 'Your room', undefined, [
          {
            text: chat.muted ? 'Unmute' : 'Mute',
            onPress: () => pref.mutate({ chatId: chat.chat_id, muted: !chat.muted }),
          },
          { text: 'Cancel', style: 'cancel' },
        ])
      }>
      <ChatRow chat={chat} last />
    </PressableScale>
  );
}

/**
 * One row in the virtualized inbox.
 *
 * A discriminated union rather than five lists, because a SectionList wants
 * one `renderItem` and the alternative is five stacked lists that cannot
 * scroll as one thing.
 */
type ChatSectionRow =
  | { kind: 'chat'; chat: ChatListRow; last: boolean }
  | { kind: 'ownRoom'; chat: ChatListRow }
  | { kind: 'incoming'; request: IncomingRequestRow; last: boolean }
  | { kind: 'waitingRow'; requests: IncomingRequestRow[] }
  | { kind: 'sent'; request: SentRequestRow; last: boolean };

type ChatSection = {
  key: string;
  title: string | null;
  /** A standing line under the heading, for a section that needs explaining. */
  note?: string;
  data: ChatSectionRow[];
};

/**
 * The key a row is known by, which is also the key `onViewableItemsChanged`
 * reports — so a conversation row's key is its chat id and nothing else, or
 * the swipe-closing pass below would be matching against the wrong thing.
 */
function sectionRowKey(item: ChatSectionRow): string {
  switch (item.kind) {
    case 'chat':
    case 'ownRoom':
      return item.chat.chat_id;
    case 'incoming':
      return `incoming:${item.request.id}`;
    case 'waitingRow':
      return 'waiting-row';
    case 'sent':
      return `sent:${item.request.id}`;
  }
}

/** A row counts as on screen once any of it is. */
const VIEWABILITY = { itemVisiblePercentThreshold: 0 } as const;

type Tab = 'individual' | 'groups';

const TAB_LABELS: { value: Tab; label: string }[] = [
  { value: 'individual', label: 'Chats' },
  { value: 'groups', label: 'Groups' },
];

/**
 * The segment you are NOT looking at is the only place a waiting group chat
 * can announce itself.
 */
function tabsWithCounts(chats: ChatListRow[], requests: number) {
  return TAB_LABELS.map((tab) => ({
    ...tab,
    badge:
      tab.value === 'individual'
        ? waitingInSegment(chats, false) + requests
        : waitingInSegment(chats, true),
  }));
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  // Dynamic Type grows the native tab bar; the constant it replaces did not.
  const tabBarInset = useTabBarInset();
  const isGuest = useIsGuest();
  const requestsQuery = useIncomingRequests();
  const chatsQuery = useMyChats();
  const requests = requestsQuery.data ?? [];
  const chats = chatsQuery.data ?? [];
  const sentRequestsQuery = useSentRequests();
  const sentRequests = sentRequestsQuery.data ?? [];
  // Destructured because a query RESULT is a new object every render while
  // its refetch is stable — which is what lets `refresh` be a stable
  // dependency instead of re-firing the focus effect on every pass.
  const { refetch: refetchChats } = chatsQuery;
  const { refetch: refetchRequests } = requestsQuery;
  const { refetch: refetchSent } = sentRequestsQuery;
  const refresh = useCallback(() => {
    refetchChats();
    refetchRequests();
    refetchSent();
  }, [refetchChats, refetchRequests, refetchSent]);

  // Unread state changes while this screen is off-stage: you read a thread,
  // somebody answers, a hello lands. Without this the dots and the tab badge
  // are whatever they were when the tab was last mounted.
  useFocusEffect(refresh);
  // A place has no Travelers tab, no groups and no discovery surface: §7 rule
  // 8 keeps it out of every one of them. Everything that assumed a traveler
  // is gated on this. Read here, above the announcement, which speaks in
  // rooms for a business.
  const isBusiness = useOwnBusiness().data != null;
  // Say the settle out loud: VoiceOver heard silence while this screen
  // loaded and silence when it resolved, so empty and loaded were
  // indistinguishable without re-exploring by hand. Failures are announced
  // by LoadError itself. Guests keep their own quiet page: its content is a
  // gate, not a list that settles. A business hears its own vocabulary:
  // its conversations are rooms, and its empty copy is the visible one.
  useAnnounce(
    !isGuest && chatsQuery.isSuccess
      ? chats.length > 0
        ? countOf(chats.length, isBusiness ? 'room' : 'chat')
        : isBusiness
          ? 'Nobody has dropped in yet'
          : 'No chats yet'
      : null
  );
  const archivedQuery = useMyChats(true);
  const archived = archivedQuery.data ?? [];
  // Never for a guest (they have no inbox to prune) and never for a business
  // (one room, which the sweep leaves alone as long as anybody writes in it).
  const archiveNotice = useArchiveNotice(!isGuest && !isBusiness);
  // The city a trip the traveler TYPED puts them in, never a device-location
  // read, and never blindly launchCities[0] (which told a traveler in
  // Bangkok that Lisbon hostels were nearby). See browsing-city.ts.
  const { cityId, cityName } = useBrowsingCity();
  const [tab, setTab] = useState<Tab>('individual');
  // Finding "the Lisbon dorm one" in an inbox with a dozen rooms in it. Kept
  // out of the tab counts on purpose: the Segmented badge answers "what is
  // waiting", which is not a question a search box should be able to change.
  const [search, setSearch] = useState('');
  // The invite paste is a real field in a sheet now, on every platform. The
  // Alert.prompt it replaces existed only on iOS; Android and web got an
  // alert with no input at all, which asked for a paste it could not take.
  const [inviteOpen, setInviteOpen] = useState(false);
  // Null for a business: it never renders the room list, so it must not pay
  // for the fetch. isBusiness resolves one query later for travelers, which
  // just starts this one a beat later on the same key.
  const roomsQuery = useCityRooms(isBusiness ? null : cityId);
  const rooms = roomsQuery.data ?? [];
  // The list used to refetch on every visit to Groups because the query
  // lived inside RoomDiscovery and remounted with it. Lifted, it would go
  // stale for the life of the mounted tab, so focus refreshes it with the
  // rest of the screen. Guarded: refetch() ignores `enabled`, and a disabled
  // null-city query must not be poked into fetching.
  const { refetch: refetchRooms } = roomsQuery;
  const roomsEnabled = !isBusiness && cityId != null;
  useFocusEffect(
    useCallback(() => {
      if (roomsEnabled) {
        refetchRooms();
      }
    }, [roomsEnabled, refetchRooms])
  );
  const theme = useTheme();

  // A business is in exactly one room, the one it runs, and my_chats hands it
  // back like any other row. The Chats/Groups switch is a traveler control, so
  // `tab` never leaves 'individual' for a business — and the kind filter under
  // it was throwing that room away on the very screen whose tab badge counts
  // the unread messages in it. The badge pointed at "No chats yet". So: no
  // switch, one list, two headings.
  const ownRoom = isBusiness ? chats.filter((c) => c.kind === 'room') : [];
  // One-to-one conversations and group rooms are different things people
  // look for at different moments, so they get a switch rather than one
  // scroll that mixes them.
  const inTab = filterChats(
    isBusiness
      ? chats.filter((c) => c.kind !== 'room')
      : chats.filter((c) => (tab === 'groups' ? c.kind === 'room' : c.kind !== 'room')),
    search
  );
  // A guest's whole chat life: the groups they were invited to. They cannot
  // have a one-to-one chat at all, since saying hi to a stranger is refused.
  const myGroups = chats.filter((c) => c.kind === 'room');
  const pinned = inTab.filter((c) => c.pinned);
  const rest = inTab.filter((c) => !c.pinned);
  const tabs = tabsWithCounts(chats, requests.length);
  // An accepted hello already has a chat row of its own, and a block the
  // PREFILTER made was refused in the composer with the text still in the box
  // — neither belongs in a waiting list. A block the CLASSIFIER made after
  // this screen confirmed the send does: nobody was told, and dropping the
  // row is how the app deletes the only copy of what somebody wrote.
  const waitingOnThem = waitingRows(sentRequests);
  // A message landing anywhere refreshes the rows while you are looking at
  // them, so the dot and the badge appear without a pull-to-refresh.
  useLiveChatList();

  // Every mounted row's swipeable, by chat id. A row that scrolls away with
  // its actions open comes back open, and the rightmost of those actions
  // archives a conversation. Both of these are held in refs on purpose:
  // React Native refuses a CHANGED onViewableItemsChanged at runtime, so the
  // handler has to keep one identity for the life of the screen, and the Map
  // has to survive every render or it would forget the rows between passes.
  const swipeables = useRef<Map<string, SwipeableMethods>>(new Map());
  const registerSwipe = useCallback((chatId: string, swipeable: SwipeableMethods | null) => {
    if (swipeable) {
      swipeables.current.set(chatId, swipeable);
    } else {
      swipeables.current.delete(chatId);
    }
  }, []);
  const closeSwipesOffScreen = useCallback(
    ({ viewableItems }: { viewableItems: { key: string }[] }) => {
      const onScreen = new Set(viewableItems.map((item) => item.key));
      swipeables.current.forEach((swipeable, chatId) => {
        if (!onScreen.has(chatId)) {
          swipeable.close();
        }
      });
    },
    []
  );

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        configError
        icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
      />
    );
  }

  if (isGuest) {
    return (
      <ThemedView style={styles.root}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            // Both segments top-aligned. The Chats side used to centre its
            // block in the leftover space (the comment here once defended
            // that); the founder's recorded call is the other way — every
            // empty state top-anchors, and the block carries a title now, so
            // it reads as an invitation rather than a list that failed.
            { paddingTop: insets.top + Spacing.four, paddingBottom: tabBarInset + Spacing.six },
          ]}>
          <View style={styles.headerRow}>
            <View style={styles.headerSwitch}>
              <Segmented
                options={tabs}
                value={tab}
                onChange={setTab}
                accessibilityLabel="Chats or groups"
              />
            </View>
            <AvatarButton />
          </View>
          {/* Keyed on the tab for the same reason as the member branch: the
              body fades in over the thumb's own 150ms travel. */}
          <Animated.View key={tab} entering={FadeIn.duration(Motion.quick)} style={styles.tabBody}>
            {tab === 'groups' ? (
              <>
                {/* A guest who accepted an invite is a member of that group,
                  and this tab is the only way back to it. Without this the
                  room was reachable exactly once, from the link, and then
                  gone. A signed-out visitor has no chats, so for them this
                  simply does not render. */}
                {myGroups.length > 0 ? (
                  <>
                    <ThemedText
                      type="smallBold"
                      themeColor="textSecondary"
                      style={styles.sectionHeading}>
                      Your groups
                    </ThemedText>
                    <View style={rowStyles.list}>
                      {myGroups.map((chat, i) => (
                        <ChatRowLink
                          key={chat.chat_id}
                          chat={chat}
                          last={i === myGroups.length - 1}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
                <ThemedText type="footnote" themeColor="textSecondary">
                  Businesses you stay at run open chats. Have a look before you join.
                </ThemedText>
                <RoomDiscovery cityName={cityName} rooms={rooms} query={roomsQuery} />
                {/* The invite landing page tells somebody who has just
                  installed to come here and paste the code. They have no
                  account yet, so they are a guest by every definition this
                  app uses — and this row lived only in the member branch,
                  which made that instruction false for the one person it
                  was written for. join-group already answers a signed-out
                  arrival with "Join with a name". Below the rooms, so it
                  stops sliding down the list as groups accumulate. */}
                <View style={rowStyles.list}>
                  <PlainRow
                    title="Have an invite?"
                    detail="Paste the link or the code somebody sent you."
                    glyph={{ ios: 'link', android: 'link', web: 'link' }}
                    tint="quiet"
                    chevron
                    last
                    accessibilityLabel="Join a group with an invite link or code"
                    onPress={() => setInviteOpen(true)}
                  />
                </View>
                <SignUpGate
                  reason={
                    myGroups.length > 0
                      ? 'Drop pins, post trips and say hi to travelers'
                      : 'Say hi to other travelers'
                  }
                  where="chat-tab"
                />
              </>
            ) : (
              // Top-anchored, like every other empty state (Tier-3 decision,
              // reversing the centred block: it floated one stray sentence in
              // a screen of empty space, with no title at all). The glyph is
              // the third thing this screen needed: one of three tabs, with
              // words alone on it, reads as a screen that failed to load
              // rather than a screen with nothing on it yet - and this is the
              // tab a curious visitor opens third, right before deciding
              // whether the app has anybody in it. Same mark the intro tour
              // uses for chat, so the two pages agree.
              <EmptyState
                glyph={{
                  ios: 'bubble.left.and.bubble.right.fill',
                  android: 'chat',
                  web: 'chat',
                }}
                title="No chats yet"
                body="One-to-one chats start when you say hi to someone and they answer.">
                {/* Pointing across, because the OTHER segment is not empty:
                    city_rooms is granted to anon, so a signed-out visitor can
                    read a hostel's open chat today. Without this line the
                    Groups toggle looked as inert as this page. Plain text, not
                    a shortcut: a Pressable with its own accessibilityLabel
                    hides the words inside it, and these words are the point. */}
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.pointer}>
                  Chats at hostels and bars are under Groups.
                </ThemedText>
                <SignUpGate reason="Say hi to other travelers" where="chat-tab" />
              </EmptyState>
            )}
          </Animated.View>
        </ScrollView>
        {inviteOpen ? <InviteCodeSheet onClose={() => setInviteOpen(false)} /> : null}
      </ThemedView>
    );
  }

  // ── THE LIST, AS SECTIONS ──────────────────────────────────────────────
  //
  // This screen used to be a ScrollView that mapped eagerly over four arrays,
  // and every ChatRowLink mounts an Image and its own signed-URL query. A
  // traveler three months into a trip with sixty conversations mounted sixty
  // rows, sixty avatars and sixty signed-URL requests every time they opened
  // the tab, and it is one of three tabs. The thread has been a proper
  // inverted FlatList since it was built, so the code already knew the
  // difference; the inbox was the one unbounded list that never got it.
  const sections: ChatSection[] = [];
  if (ownRoom.length > 0) {
    sections.push({
      key: 'own-room',
      title: 'Your room',
      data: ownRoom.map((chat) => ({ kind: 'ownRoom' as const, chat })),
    });
  }
  // Nobody says hi to a business: travelers write in through message_business,
  // which makes a conversation rather than a hello waiting on an answer. Both
  // halves of that loop are traveler-only.
  if (requests.length > 0 && tab === 'individual' && !isBusiness) {
    sections.push({
      key: 'waiting',
      title: 'Waiting on you',
      data:
        requests.length >= WAITING_COLLAPSE_AT
          ? [{ kind: 'waitingRow' as const, requests }]
          : requests.map((request, i) => ({
              kind: 'incoming' as const,
              request,
              // The last card pays no bottom padding: the section below it
              // brings its own, and doubling them opened a gap twice the size
              // of the one between the cards.
              last: i === requests.length - 1,
            })),
    });
  }
  // Your side of the loop. Only the ones still waiting: once somebody answers,
  // the hello IS the chat and lives in the list below.
  if (tab === 'individual' && waitingOnThem.length > 0 && !isBusiness) {
    sections.push({
      key: 'said-hi',
      title: 'You said hi',
      // The durable half of the sent confirmation. That card lives about a
      // second; this is where somebody comes looking a day later, wondering
      // whether silence means no. It never does, and saying so here is what
      // keeps the app from having to say anything about the other person.
      // Only when something IS waiting. This section now also holds hellos
      // the classifier stopped after sending, whose row reads 'Not delivered'
      // — and a heading saying "waiting on an answer" directly above one of
      // those tells somebody their message is with a person who has not
      // replied, when in fact it never left. Scoped rather than reworded: the
      // sentence is the right one for the rows it is true of.
      note: waitingOnThem.some((request) => !request.blocked_after_send)
        ? 'Waiting on an answer. You only hear back when somebody replies.'
        : undefined,
      data: waitingOnThem.map((request, i) => ({
        kind: 'sent' as const,
        request,
        last: i === waitingOnThem.length - 1,
      })),
    });
  }
  if (pinned.length > 0) {
    sections.push({
      key: 'pinned',
      title: 'Pinned',
      data: pinned.map((chat, i) => ({
        kind: 'chat' as const,
        chat,
        last: i === pinned.length - 1,
      })),
    });
  }
  if (rest.length > 0) {
    sections.push({
      key: 'rest',
      // Only a heading when there is something above it to be separated from.
      // The segment already says "Chats"; repeating it directly underneath is
      // a label labelling itself.
      title:
        requests.length > 0 || pinned.length > 0 || ownRoom.length > 0
          ? isBusiness
            ? 'From travelers'
            : tab === 'groups'
              ? 'Groups'
              : 'Chats'
          : null,
      data: rest.map((chat, i) => ({
        kind: 'chat' as const,
        chat,
        last: i === rest.length - 1,
      })),
    });
  }

  return (
    <ThemedView style={styles.root}>
      <View style={styles.scroll}>
        <View style={[styles.header, { paddingTop: insets.top + Spacing.four }]}>
          <View style={styles.headerRow}>
            <View style={styles.headerSwitch}>
              {/* No segments for a place. Groups is a traveler surface it
                can neither join nor start, so the control offered a
                choice with one real option in it. */}
              {isBusiness ? (
                <ThemedText type="title" accessibilityRole="header">
                  Messages
                </ThemedText>
              ) : (
                <Segmented
                  options={tabs}
                  value={tab}
                  onChange={setTab}
                  accessibilityLabel="Chats or groups"
                />
              )}
            </View>
            {/* One meaning, on both segments: start a chat and invite people
              to it. It used to change under the person's hand — a new
              group on Groups, the Travelers tab on Chats — so tapping '+'
              on the tab you were reading messages in took you out of Chat
              entirely, to a screen about meeting strangers. A control that
              does two different things depending on a segment you may not
              have noticed is a control nobody can learn. Starting a group
              is also the honest answer for both: a one-to-one chat cannot
              be STARTED here at all, it opens when somebody answers a
              hello. A business gets none of this — §7 rule 8 keeps it out
              of groups. */}
            {isBusiness ? null : (
              <PressableScale
                accessibilityRole="button"
                // "New group", because that is where it goes. It said "Start
                // a chat" while pushing /new-group, and this screen cannot
                // start a one-to-one chat at all — the hint is the only
                // place a VoiceOver user can learn that from this screen.
                accessibilityLabel="New group"
                accessibilityHint="One-to-one chats open when someone answers your first message"
                haptic="light"
                scaleTo={0.92}
                onPress={() => router.push('/new-group')}
                style={[styles.headerAction, { backgroundColor: theme.surface }]}>
                <SymbolView
                  name={{ ios: 'person.2.badge.plus', android: 'group_add', web: 'group_add' }}
                  size={18}
                  tintColor={theme.accent}
                />
              </PressableScale>
            )}
            <AvatarButton />
          </View>

          {/* The one field. Under the switch rather than over it, so the tab
            names stay the first thing read, and always mounted rather than
            behind a magnifier: a control that has to be found before it
            can be used is a control most people never find. Its own row,
            because a search field beside a Segmented at accessibility text
            sizes leaves neither of them usable. */}
          {chats.length >= SEARCH_APPEARS_AT ? (
            <FormTextField
              value={search}
              onChangeText={setSearch}
              placeholder="Search your chats"
              accessibilityLabel="Search your chats"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
          ) : null}
        </View>
        {/* Keyed on the tab so the list body fades in over the same 150ms the
            segmented thumb spends travelling — without it the content swapped
            in the same commit the thumb started moving, and for those 150ms
            the thumb sat over Chats while the screen showed groups. FadeIn is
            safe here: the Fade presets animate opacity only and never own the
            frame, unlike the Slide family (see the traps skill).

            The chrome above stays OUTSIDE it, which is what a virtualized
            list costs: a keyed wrapper around a SectionList that carried its
            own header would blink the very control being tapped, and
            remounting the search field would drop the keyboard mid-word. So
            the switch, the field and the notice are pinned and the
            conversations scroll under them. */}
        <Animated.View key={tab} entering={FadeIn.duration(Motion.quick)} style={styles.listBody}>
          <SectionList
            sections={sections}
            keyExtractor={sectionRowKey}
            stickySectionHeadersEnabled={false}
            // A tap on a row while the keyboard is up must OPEN the row, not just
            // dismiss the keyboard and make the person tap twice. 'always' rather
            // than 'handled' deliberately: 'handled' asks the responder chain
            // whether a child wants the touch, and the reaction menu's
            // capture-phase responder is exactly the kind of thing that answers
            // wrongly - that bug cost this project weeks once already.
            keyboardShouldPersistTaps="always"
            // Nothing in the app could be pulled to refresh, on the one screen
            // people reflexively pull.
            refreshControl={
              <RefreshControl
                refreshing={chatsQuery.isFetching || requestsQuery.isFetching}
                onRefresh={refresh}
                tintColor={theme.textSecondary}
              />
            }
            // A row that scrolls away with its actions open comes back open, and
            // what is behind them archives a conversation. Both handlers are held
            // in refs: React Native refuses a changed onViewableItemsChanged.
            viewabilityConfig={VIEWABILITY}
            onViewableItemsChanged={closeSwipesOffScreen}
            contentContainerStyle={{ paddingBottom: tabBarInset + Spacing.six }}
            renderSectionHeader={({ section }) =>
              section.title ? (
                <View style={styles.listSectionHeading}>
                  <ThemedText type="smallBold" themeColor="textSecondary">
                    {section.title}
                  </ThemedText>
                  {section.note ? (
                    <ThemedText
                      type="footnote"
                      themeColor="textSecondary"
                      style={styles.listSectionNote}>
                      {section.note}
                    </ThemedText>
                  ) : null}
                </View>
              ) : (
                // The gap a heading would have carried, so an unlabelled section
                // does not run straight into the one above it.
                <View style={styles.headlessSection} />
              )
            }
            renderItem={({ item }) => {
              switch (item.kind) {
                case 'ownRoom':
                  return <OwnRoomRow chat={item.chat} />;
                case 'waitingRow':
                  return <WaitingOnYouRow requests={item.requests} />;
                case 'incoming':
                  return (
                    <View style={item.last ? styles.gutter : styles.gutterStacked}>
                      <IncomingRequestCard request={item.request} />
                    </View>
                  );
                case 'sent':
                  return <SentHelloRow request={item.request} last={item.last} />;
                case 'chat':
                  return (
                    <ChatRowLink chat={item.chat} last={item.last} registerSwipe={registerSwipe} />
                  );
              }
            }}
            // The notice scrolls with the list, unlike the switch and the
            // field above it. It is a transient courtesy rather than a
            // control, so nothing is lost by letting it leave the screen -
            // and keeping it pinned added a third band of chrome above the
            // conversations, which at the largest accessibility text sizes on
            // a small phone left barely a row of list visible. The controls
            // stay pinned for the reason written above: remounting the search
            // field drops the keyboard mid-word.
            ListHeaderComponent={
              archiveNotice.count > 0 ? (
                <View style={styles.gutterStacked}>
                  <ArchiveNotice count={archiveNotice.count} onDismiss={archiveNotice.dismiss} />
                </View>
              ) : null
            }
            ListFooterComponent={
              // The gutter is paid here, not by the list: a conversation row
              // pads itself to 16 and would sit at 40 inside a padded
              // container, and the PlainRow blocks below cancel this padding
              // with rowStyles.list so they land at 16 too.
              <View style={styles.footer}>
                {/* The shape of the list, while the list is on its way. Only on a
              genuinely cold start: once there are cached rows they are shown
              instead, because real slightly-stale content beats a placeholder
              every time. */}
                {chatsQuery.isPending && chats.length === 0 ? (
                  <>
                    <ChatRowSkeleton />
                    <ChatRowSkeleton />
                    <ChatRowSkeleton />
                  </>
                ) : null}

                {/* A failed fetch is not an empty inbox. Somebody with six
              conversations, offline, was being told they had none. */}
                {chatsQuery.isError ? (
                  <LoadError compact what="your chats" error={chatsQuery.error} onRetry={refresh} />
                ) : null}
                {/* Same for the hellos waiting on you: silence here used to let "No
              chats yet" render over people who were actually waiting. */}
                {/* Never to a business: nobody says hi to one, so an error about the
              hellos waiting on it is a sentence about a feature it does not
              have. */}
                {requestsQuery.isError && !chatsQuery.isError && !isBusiness ? (
                  <LoadError
                    compact
                    what="the first messages waiting on you"
                    error={requestsQuery.error}
                    onRetry={refresh}
                  />
                ) : null}

                {/* Empty states are invitations: name the one next action.
              Three things had to be true before this card could tell the truth,
              and none of them were. It painted UNDER the three loading
              skeletons on a cold start, so the first thing a returning user
              saw was "No chats yet" over their own chats arriving. It painted
              under "You said hi - Sent", so the screen said both at once,
              seconds after somebody's first hello. And a failed
              incoming-requests fetch could put it over hellos that were
              waiting. */}
                {!chatsQuery.isError &&
                !requestsQuery.isError &&
                chatsQuery.isSuccess &&
                // The groups sentence branches on rooms.length, so it must not
                // render until the rooms have answered: committing to "Start one"
                // a frame before rooms appear below is the same transient wrong
                // statement the honest-city package exists to remove.
                (tab !== 'groups' || !roomsQuery.isPending) &&
                inTab.length === 0 &&
                (tab === 'groups' || (requests.length === 0 && waitingOnThem.length === 0)) ? (
                  <EmptyState
                    title={
                      isBusiness
                        ? 'Nobody has dropped in yet'
                        : tab === 'groups'
                          ? 'No groups yet'
                          : 'No chats yet'
                    }
                    body={
                      isBusiness
                        ? 'Put up what is on this week, and travelers who find you on the map can join.'
                        : tab === 'groups'
                          ? // "below" may only be said while something IS below:
                            // with no rooms the sentence pointed at nothing, and a
                            // roomless city read as a broken screen.
                            rooms.length > 0
                            ? 'Join an open chat below, or start your own.'
                            : cityName
                              ? `Start one and it shows up here for travelers in ${cityName}.`
                              : 'Start one and it shows up here for other travelers.'
                          : 'Say hi to someone going your way. The chat opens when they answer.'
                    }
                    // One next action per branch. Find travelers and Start a group
                    // are traveler-only and hidden from a place ("Post something"
                    // is the title of the screen it opens, so the control says
                    // exactly what happens).
                    action={
                      isBusiness
                        ? { label: 'Post something', onPress: () => router.push('/business-post') }
                        : tab === 'groups'
                          ? { label: 'Start a group', onPress: () => router.push('/new-group') }
                          : { label: 'Find travelers', onPress: () => router.push('/travelers') }
                    }
                  />
                ) : null}

                {tab === 'groups' && !isBusiness ? (
                  <>
                    <RoomDiscovery cityName={cityName} rooms={rooms} query={roomsQuery} />
                    {/* Below the rooms, so the row stops sliding down the list as
                groups accumulate. It is a destination, not a conversation. */}
                    <View style={rowStyles.list}>
                      <PlainRow
                        title="Have an invite?"
                        detail="Paste the link or the code somebody sent you."
                        glyph={{ ios: 'link', android: 'link', web: 'link' }}
                        tint="quiet"
                        chevron
                        last
                        accessibilityLabel="Join a group with an invite link or code"
                        onPress={() => setInviteOpen(true)}
                      />
                    </View>
                  </>
                ) : null}

                {/* The door stays on the screen once the query has answered, with a
              zero on it if that is the truth. It used to appear only after
              something had been archived, which meant the one person who
              needed to find it - somebody hunting for a name the nightly
              sweep had moved - had to already be behind it. */}
                {archivedQuery.isSuccess ? (
                  <View style={rowStyles.list}>
                    <PlainRow
                      title="Archived"
                      detail={
                        archived.length > 0
                          ? `${countOf(archived.length, 'chat')} · still readable`
                          : 'Nothing archived yet'
                      }
                      glyph={{ ios: 'archivebox.fill', android: 'archive', web: 'archive' }}
                      tint="quiet"
                      chevron
                      last
                      onPress={() => router.push('/archived-chats')}
                    />
                  </View>
                ) : null}
              </View>
            }
          />
        </Animated.View>
      </View>
      {inviteOpen ? <InviteCodeSheet onClose={() => setInviteOpen(false)} /> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  /* The keyed fade wrapper stands in for the scroll content it now contains,
     so it carries the same gap the content container puts between sections. */
  tabBody: {
    gap: Spacing.three,
  },
  /* The chrome above the conversations, inside the list so it scrolls away
     with them the way it always has. It pays the gutter; the rows below do
     not, because each one cancels it for itself. */
  header: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  /* The list fills what the pinned chrome leaves. Without this the keyed
     wrapper collapses to its content height and the SectionList inside it
     has nothing to scroll in. */
  listBody: {
    flex: 1,
  },
  /* Everything under the conversations: the skeletons, the failures, the
     empty state, the open rooms and the two destinations. */
  footer: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  /* A section with no heading still needs the air one would have carried, or
     it runs straight into the section above it. */
  headlessSection: {
    height: Spacing.three,
  },
  /* An incoming hello is a card, not a flush row, so it keeps the inset the
     scroller used to give it. */
  gutter: {
    paddingHorizontal: Spacing.four,
  },
  /* An inline hello card is its own list item now, and a list item has no
     gap. Two waiting hellos abutted with no air between them, where the old
     flex column gave them 16pt. */
  gutterStacked: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerSwitch: {
    flex: 1,
  },
  headerAction: {
    width: HitTarget,
    height: HitTarget,
    // A circle, like every other round-glyph control in the app (back
    // buttons, send, room avatars) and like the AvatarButton beside it. The
    // rounded square was the one odd shape in the row.
    borderRadius: HitTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  /* A flush list needs its headings to sit ON the gutter rather than float
     in the gap between two cards. The vertical values are what the old
     wrapper's `gap` used to supply: 16 of air, then the heading's own 8. */
  /* For the two headings that sit INSIDE an already-padded container
     (RoomDiscovery's "Rooms in ..." and the guest tab's "Your groups").
     Unchanged from before the list conversion: adding horizontal padding here
     double-applied it and indented those two headings 48pt while every row
     beside them sat at 24. */
  sectionHeading: {
    paddingTop: Spacing.two,
  },
  /* For the SectionList's own headers, which sit in a content container with
     no padding of its own and therefore carry the gutter themselves. */
  listSectionHeading: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three + Spacing.two,
    paddingBottom: Spacing.three,
  },
  /* The standing line some headings carry. Sits under the heading, in the
     same gutter, so it reads as part of it rather than as a first row. */
  listSectionNote: {
    paddingTop: Spacing.one,
  },
  /* The line that says the other segment has something on it. Centred with
     the block it sits in. */
  pointer: {
    textAlign: 'center',
  },
  /* One quiet line, not a card: it is a notice about housekeeping, and the
     conversations under it are what the screen is for. */
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingLeft: Spacing.three,
  },
  noticeBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  noticeText: {
    flex: 1,
  },
  noticeClose: {
    width: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Three faces in the space of one avatar column, so the row's text still
     starts on the same vertical line as every other row's. */
  faceStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  face: {
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
  faceOverlap: {
    marginLeft: -14,
  },
});
