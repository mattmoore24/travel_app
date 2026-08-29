import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { AvatarButton } from '@/components/ui/avatar-button';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Segmented } from '@/components/ui/segmented';
import { ChatRowSkeleton } from '@/components/ui/skeleton';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useIsPlaceChat, useOwnBusiness } from '@/features/business/hooks';
import { finiteDate } from '@/features/groups/closing';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import { useIsGuest } from '@/features/guest/hooks';
import { useLaunchCities } from '@/features/pins/hooks';
import { rowTimestamp, unreadLabel } from '@/features/chat/separators';
import { useLiveChatList } from '@/features/chat/hooks';
import { anchorAboutYours } from '@/features/chat/anchors';
import { waitingInSegment } from '@/features/chat/unread';
import { useChatPref, useCityRooms } from '@/features/rooms/hooks';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import {
  BottomTabInset,
  HitTarget,
  MaxContentWidth,
  Radius,
  Space,
  Spacing,
} from '@/constants/theme';
import {
  useIncomingRequests,
  useMyChats,
  useRespondToRequest,
  useSentRequests,
} from '@/features/matching/hooks';
import { usePhotoUrl, usePublicPhotos, usePublicProfile } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import { countOf } from '@/lib/plural';
import type { ChatListRow, IncomingRequestRow, SentRequestRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * The conversation-row avatar, at the size the messaging apps converged on.
 *
 * With the 16pt leading inset and the 12pt gap after it, this puts the text
 * column at x=80 — and the row separator starts there too, which is what
 * makes a list of avatars read as one column rather than as stacked cards.
 */
const AVATAR = 52;

function Avatar({ path, size = 48 }: { path: string | null; size?: number }) {
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
function PlaceAvatar({ path, size = 48 }: { path: string | null; size?: number }) {
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

function RequestCard({ request }: { request: IncomingRequestRow }) {
  const theme = useTheme();
  const respond = useRespondToRequest();
  const [acting, setActing] = useState<'accept' | 'decline' | null>(null);

  const act = async (accept: boolean) => {
    setActing(accept ? 'accept' : 'decline');
    try {
      const result = await respond.mutateAsync({ requestId: request.id, accept });
      if (result.accepted && result.chat_id) {
        haptics.success();
        router.push(`/chat/${result.chat_id}`);
      }
    } catch {
      // Surfaced by the global mutation error alert.
    } finally {
      setActing(null);
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.requestCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${request.display_name ?? 'traveler'}'s full profile`}
        onPress={() => router.push(`/profile/${request.sender_id}`)}
        style={({ pressed }) => [styles.requestHeader, pressed && styles.pressed]}>
        <Avatar path={request.photo_path} />
        <View style={styles.requestHeaderText}>
          <View style={styles.nameRow}>
            <ThemedText type="smallBold">
              {request.display_name ?? 'Traveler'}
              {request.age != null ? `, ${request.age}` : ''}
            </ThemedText>
            {request.verified ? (
              <VerifiedSeal name={request.display_name} age={request.age} />
            ) : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {request.profile_element ? `about ${anchorAboutYours(request.profile_element)} · ` : ''}
            view full profile
          </ThemedText>
        </View>
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={14}
          tintColor={theme.textSecondary}
        />
      </Pressable>
      <ThemedText>{request.first_message}</ThemedText>
      {/* The receiver's half of moderation. This is the one screen in the app
          where a stranger's words arrive unasked-for, and until now the only
          answers on it were accept and decline — reporting meant going and
          finding the profile first. Asking the question out loud is also
          what makes people answer it (Tinder's version lifted reports 46%). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report this message"
        hitSlop={8}
        onPress={() =>
          router.push({
            pathname: '/report',
            params: { userId: request.sender_id, context: `request:${request.id}` },
          })
        }>
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.feelsOff}>
          Does this feel off? Tell us.
        </ThemedText>
      </Pressable>
      <View style={styles.requestActions}>
        <View style={styles.actionButton}>
          <PrimaryButton
            variant="ghost"
            label="Decline"
            loading={acting === 'decline'}
            disabled={respond.isPending}
            onPress={() => act(false)}
          />
        </View>
        <View style={styles.actionButton}>
          <PrimaryButton
            label="Accept"
            loading={acting === 'accept'}
            disabled={respond.isPending}
            onPress={() => act(true)}
          />
        </View>
      </View>
    </ThemedView>
  );
}

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
  const theme = useTheme();
  const { data: profile } = usePublicProfile(request.recipient_id);
  const { data: photos = [] } = usePublicPhotos(request.recipient_id);
  const photoPath = photos.find((p) => p.position === 0)?.storage_path ?? null;
  const name = profile?.display_name ?? 'Traveler';

  // The same row geometry as a conversation, quieter. A hello with no answer
  // is not a chat yet — tapping it opens a profile, not a thread — so the
  // avatar is smaller, the name is not bold, and the trailing word says what
  // state it is in rather than when it happened.
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`You said hi to ${name}`}
      accessibilityHint="Opens their profile"
      scaleTo={0.99}
      onPress={() => router.push(`/profile/${request.recipient_id}`)}>
      <View style={styles.row}>
        <View style={styles.unreadGutter} />
        <Avatar path={photoPath} size={AVATAR - 8} />
        <View style={styles.rowBody}>
          <ThemedText type="body" style={styles.rowNameRead} numberOfLines={1}>
            {name}
          </ThemedText>
          <ThemedText
            type="callout"
            themeColor="textSecondary"
            numberOfLines={2}
            style={styles.rowPreview}>
            You: {request.first_message}
          </ThemedText>
        </View>
        <View style={styles.rowTrailing}>
          <ThemedText type="footnote" themeColor="textSecondary">
            Sent
          </ThemedText>
        </View>
        {last ? null : <View style={[styles.separator, { backgroundColor: theme.hairline }]} />}
      </View>
    </PressableScale>
  );
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
function ChatRow({ chat, last = false }: { chat: ChatListRow; last?: boolean }) {
  const theme = useTheme();
  const isRoom = chat.kind === 'room';
  // A conversation with a BUSINESS carries the business's cover photo, which
  // lives in a different bucket. Signed through the profile hook it comes back
  // a 404 wearing a valid-looking URL, so the row fell back to a person glyph
  // for a bar — and on the business's own side of the same row, where the
  // photo is the TRAVELER's, it did the reverse. See useIsPlaceChat.
  const isPlace = useIsPlaceChat(chat.kind);
  const unread = chat.unread_count > 0;
  const stamp = rowTimestamp(chat.last_message_at ?? chat.created_at);
  const closed = chat.chat_status !== 'active';
  // A group with nothing said in it yet has no preview to show, so the row
  // says who is in it instead of sitting empty. Once somebody writes, the
  // message wins: how many people are here is on the group's own screen, and
  // a third line of metadata under every row is exactly the clutter this
  // layout exists to remove.
  // `expires_at` is NOT NULL on the server, so the admin of a chat with no
  // end date holds an infinite seat and PostgREST sends the string
  // "infinity" — truthy, and `new Date` of it is Invalid Date.
  const leaveOn = isRoom ? finiteDate(chat.expires_at) : null;
  const preview =
    chat.last_message ??
    chat.first_message ??
    (isRoom && chat.member_count != null
      ? `${countOf(chat.member_count, 'person', 'people')} here` +
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
          style={styles.rowPreview}>
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
  const theme = useTheme();
  const accented = tint !== 'quiet';
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      haptic="light"
      scaleTo={0.995}
      onPress={onPress}>
      <View style={styles.row}>
        <View style={styles.unreadGutter} />
        <View
          style={[
            styles.roomBadge,
            { backgroundColor: accented ? theme.accentSoft : theme.surfaceSunken },
          ]}>
          <SymbolView
            name={glyph}
            size={22}
            tintColor={accented ? theme.accent : theme.textSecondary}
          />
        </View>
        <View style={styles.rowBody}>
          <ThemedText type="body" style={styles.rowNameRead} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText
            type="callout"
            themeColor="textSecondary"
            numberOfLines={2}
            style={styles.rowPreview}>
            {detail}
          </ThemedText>
        </View>
        {chevron ? (
          <View style={styles.rowTrailing}>
            <SymbolView
              name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
              size={13}
              tintColor={theme.textSecondary}
            />
          </View>
        ) : null}
        {last ? null : <View style={[styles.separator, { backgroundColor: theme.hairline }]} />}
      </View>
    </PressableScale>
  );
}

/** Rooms a signed-out visitor (or a signed-in non-member) can look inside. */
function RoomDiscovery({ cityId }: { cityId: number | null }) {
  const { data: rooms = [] } = useCityRooms(cityId);
  if (rooms.length === 0) {
    return null;
  }
  return (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
        Rooms near you
      </ThemedText>
      <View style={styles.list}>
        {rooms.map((room, i) => (
          <PlainRow
            key={room.chat_id}
            title={room.name}
            detail={`${countOf(room.member_count, 'guest')} here now`}
            glyph={{ ios: 'house.fill', android: 'home', web: 'home' }}
            last={i === rooms.length - 1}
            onPress={() => router.push(`/room/${room.chat_id}`)}
          />
        ))}
      </View>
    </>
  );
}

/** A row plus its long-press actions — pin, mute, archive (docs/DESIGN.md). */
/** One button behind a swiped row. */
function SwipeAction({
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

function ChatRowLink({ chat, last = false }: { chat: ChatListRow; last?: boolean }) {
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
      ref={swipe}
      friction={2}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <SwipeAction
            label={chat.pinned ? 'Unpin' : 'Pin'}
            icon={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
            tint={theme.accent}
            onPress={() => act({ pinned: !chat.pinned })}
          />
          <SwipeAction
            label={chat.muted ? 'Unmute' : 'Mute'}
            icon={
              chat.muted
                ? { ios: 'bell.fill', android: 'notifications', web: 'notifications' }
                : { ios: 'bell.slash.fill', android: 'notifications_off', web: 'notifications_off' }
            }
            tint={theme.textSecondary}
            onPress={() => act({ muted: !chat.muted })}
          />
          <SwipeAction
            label="Archive"
            icon={{ ios: 'archivebox.fill', android: 'archive', web: 'archive' }}
            tint={theme.danger}
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

/**
 * A samewhere:// link is not tappable in every text message app, so the code
 * inside it is a first-class way in rather than a fallback nobody mentions.
 */
function promptForInvite() {
  const open = (code: string | undefined) => {
    const token = (code ?? '').trim();
    if (token.length > 0) {
      router.push(`/join-group/${encodeURIComponent(token)}`);
    }
  };
  if (Platform.OS === 'ios' && Alert.prompt) {
    Alert.prompt('Invite code', 'Open the invite link you were sent.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Join', onPress: open },
    ]);
  } else {
    Alert.alert('Invite code', 'Open the invite link you were sent to join the group.');
  }
}

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
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
  const { data: launchCities = [] } = useLaunchCities();
  const { data: archived = [] } = useMyChats(true);
  const cityId = launchCities[0]?.city_id ?? null;
  const [tab, setTab] = useState<Tab>('individual');
  // A place has no Travelers tab, no groups and no discovery surface: §7 rule
  // 8 keeps it out of every one of them. Everything that assumed a traveler
  // is gated on this.
  const isBusiness = useOwnBusiness().data != null;
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
  const inTab = isBusiness
    ? chats.filter((c) => c.kind !== 'room')
    : chats.filter((c) => (tab === 'groups' ? c.kind === 'room' : c.kind !== 'room'));
  // A guest's whole chat life: the groups they were invited to. They cannot
  // have a one-to-one chat at all, since saying hi to a stranger is refused.
  const myGroups = chats.filter((c) => c.kind === 'room');
  const pinned = inTab.filter((c) => c.pinned);
  const rest = inTab.filter((c) => !c.pinned);
  const tabs = tabsWithCounts(chats, requests.length);
  // 'sent' only. An accepted request already has a chat row of its own, and
  // 'blocked' is the sender's own doing — neither belongs in a waiting list.
  const waitingOnThem = sentRequests.filter((request) => request.state === 'sent');
  // A message landing anywhere refreshes the rows while you are looking at
  // them, so the dot and the badge appear without a pull-to-refresh.
  useLiveChatList();

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
        title="Inbox"
        phase="waiting on backend keys"
        description="Chats show up here once Supabase keys are in .env."
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
            // Grow to fill on the Chats side. A guest has no one-to-one chats
            // by definition, so that tab is one sentence and a card — and
            // top-aligned they ended at the halfway line with 350pt of empty
            // canvas under them, which reads as a list that failed to load
            // rather than as an invitation. Groups stays top-aligned: it has
            // the room list in it and that scrolls.
            tab === 'groups' ? null : styles.guestFill,
            { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
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
                  <View style={styles.list}>
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
              <RoomDiscovery cityId={cityId} />
              <SignUpGate
                reason={
                  myGroups.length > 0
                    ? 'Pins, trips and meeting travelers need a profile'
                    : 'Want to join in?'
                }
                where="chat-tab"
                cta="Make a profile"
              />
            </>
          ) : (
            <View style={styles.guestCentre}>
              <ThemedText type="footnote" themeColor="textSecondary">
                One-to-one chats start when you say hi to someone and they answer.
              </ThemedText>
              <SignUpGate reason="Want to join in?" where="chat-tab" cta="Make a profile" />
            </View>
          )}
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        // Nothing in the app could be pulled to refresh, on the one screen
        // people reflexively pull.
        refreshControl={
          <RefreshControl
            refreshing={chatsQuery.isFetching || requestsQuery.isFetching}
            onRefresh={refresh}
            tintColor={theme.textSecondary}
          />
        }
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
        ]}>
        <View style={styles.headerRow}>
          <View style={styles.headerSwitch}>
            {/* No segments for a place. Groups is a traveler surface it can
                neither join nor start, so the control offered a choice with
                one real option in it. */}
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
          {/* One meaning, on both segments: start a chat and invite people to
              it. It used to change under the person's hand — a new group on
              Groups, the Travelers tab on Chats — so tapping '+' on the tab
              you were reading messages in took you out of Chat entirely, to a
              screen about meeting strangers. A control that does two
              different things depending on a segment you may not have noticed
              is a control nobody can learn. Starting a group is also the
              honest answer for both: a one-to-one chat cannot be STARTED
              here at all, it opens when somebody answers a hello. A business
              gets none of this — §7 rule 8 keeps it out of groups. */}
          {isBusiness ? null : (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Start a chat"
              haptic="light"
              scaleTo={0.92}
              onPress={() => router.push('/new-group')}
              style={[styles.headerAction, { backgroundColor: theme.surface }]}>
              <SymbolView
                name={{ ios: 'plus', android: 'add', web: 'add' }}
                size={18}
                tintColor={theme.accent}
              />
            </PressableScale>
          )}
          <AvatarButton />
        </View>

        {/* A business's own room, above its inbox. It is the one place
            travelers gather around the business, and until now the only way
            back into it was the map. */}
        {ownRoom.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
              Your room
            </ThemedText>
            <View style={styles.list}>
              {ownRoom.map((chat) => (
                <OwnRoomRow key={chat.chat_id} chat={chat} />
              ))}
            </View>
          </>
        ) : null}

        {/* Nobody says hi to a business: travelers write in through
            message_business, which makes a conversation rather than a hello
            waiting on an answer. Both halves of that loop are traveler-only,
            and a business reading its inbox should not carry either heading. */}
        {requests.length > 0 && tab === 'individual' && !isBusiness ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
              Waiting on you
            </ThemedText>
            {requests.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </>
        ) : null}

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

        {/* Your side of the loop. Only the ones still waiting: once somebody
            answers, the hello IS the chat and lives in the list below. */}
        {tab === 'individual' && waitingOnThem.length > 0 && !isBusiness ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
              You said hi
            </ThemedText>
            <View style={styles.list}>
              {waitingOnThem.map((request, i) => (
                <SentHelloRow
                  key={request.id}
                  request={request}
                  last={i === waitingOnThem.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}

        {pinned.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
              Pinned
            </ThemedText>
            <View style={styles.list}>
              {pinned.map((chat, i) => (
                <ChatRowLink key={chat.chat_id} chat={chat} last={i === pinned.length - 1} />
              ))}
            </View>
          </>
        ) : null}

        {rest.length > 0 ? (
          <>
            {/* Only a heading when there is something above it to be
                separated from. The segment already says "Chats"; repeating
                it directly underneath is a label labelling itself. */}
            {requests.length > 0 || pinned.length > 0 || ownRoom.length > 0 ? (
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.sectionHeading}>
                {isBusiness ? 'From travelers' : tab === 'groups' ? 'Groups' : 'Chats'}
              </ThemedText>
            ) : null}
            <View style={styles.list}>
              {rest.map((chat, i) => (
                <ChatRowLink key={chat.chat_id} chat={chat} last={i === rest.length - 1} />
              ))}
            </View>
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
            what="the hellos waiting on you"
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
        inTab.length === 0 &&
        (tab === 'groups' || (requests.length === 0 && waitingOnThem.length === 0)) ? (
          <ThemedView type="backgroundElement" style={styles.emptyCard}>
            <ThemedText type="callout">
              {isBusiness ? 'No messages yet' : tab === 'groups' ? 'No groups yet' : 'No chats yet'}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {isBusiness
                ? 'Travelers who find you on the map can write to you here.'
                : tab === 'groups'
                  ? 'Join an open chat below, or start your own.'
                  : 'Say hi to someone going your way. The chat opens when they answer.'}
            </ThemedText>
            {/* Both routes below are traveler-only and hidden from a place,
                so for a business account these were two buttons that could
                not do anything. */}
            {tab === 'individual' && !isBusiness ? (
              <PrimaryButton label="Find travelers" onPress={() => router.push('/travelers')} />
            ) : null}
          </ThemedView>
        ) : null}

        {tab === 'groups' && !isBusiness ? (
          <>
            <View style={styles.list}>
              <PlainRow
                title="Have an invite?"
                detail="Paste the code somebody sent you."
                glyph={{ ios: 'link', android: 'link', web: 'link' }}
                tint="quiet"
                chevron
                last
                accessibilityLabel="Join a group with an invite code"
                onPress={promptForInvite}
              />
            </View>
            <RoomDiscovery cityId={cityId} />
          </>
        ) : null}

        {archived.length > 0 ? (
          <View style={styles.list}>
            <PlainRow
              title="Archived"
              detail={`${countOf(archived.length, 'chat')} · still readable`}
              glyph={{ ios: 'archivebox.fill', android: 'archive', web: 'archive' }}
              tint="quiet"
              chevron
              last
              onPress={() => router.push('/archived-chats')}
            />
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  guestFill: {
    flexGrow: 1,
  },
  guestCentre: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
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
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    gap: Spacing.three,
    padding: Spacing.four,
    borderRadius: Radius.xl,
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
  strong: {
    fontWeight: '600',
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
  feelsOff: {
    textDecorationLine: 'underline',
  },
  /* A flush list needs its headings to sit ON the gutter rather than float
     in the gap between two cards. */
  sectionHeading: {
    paddingTop: Spacing.two,
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
  requestCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
  requestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  requestHeaderText: {
    flex: 1,
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  requestActions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  actionButton: {
    flex: 1,
  },
  /* Cancels the scroller's own 24pt gutter so the rows and their separators
     run edge to edge, then each row pads itself back in. Everything else on
     the screen keeps the gutter. */
  list: {
    marginHorizontal: -Spacing.four,
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
     being able to name it. */
  rowPreview: {
    height: 40,
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
  pressed: {
    opacity: 0.7,
  },
});
