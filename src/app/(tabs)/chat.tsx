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
import { BottomTabInset, HitTarget, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
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
function SentHelloRow({ request }: { request: SentRequestRow }) {
  const theme = useTheme();
  const { data: profile } = usePublicProfile(request.recipient_id);
  const { data: photos = [] } = usePublicPhotos(request.recipient_id);
  const photoPath = photos.find((p) => p.position === 0)?.storage_path ?? null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`You said hi to ${profile?.display_name ?? 'a traveler'}`}
      scaleTo={0.98}
      onPress={() => router.push(`/profile/${request.recipient_id}`)}>
      <ThemedView type="backgroundElement" style={styles.chatRow}>
        <Avatar path={photoPath} />
        <View style={styles.chatRowText}>
          <ThemedText type="callout" style={styles.strong} numberOfLines={1}>
            {profile?.display_name ?? 'Traveler'}
          </ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {request.first_message}
          </ThemedText>
        </View>
        <View style={[styles.sentTag, { backgroundColor: theme.surfaceSunken }]}>
          <ThemedText type="caption" themeColor="textSecondary">
            Sent
          </ThemedText>
        </View>
      </ThemedView>
    </PressableScale>
  );
}

function ChatRow({ chat }: { chat: ChatListRow }) {
  const theme = useTheme();
  const preview = chat.last_message ?? chat.first_message;
  const isRoom = chat.kind === 'room';
  const unread = chat.unread_count > 0;
  const stamp = rowTimestamp(chat.last_message_at ?? chat.created_at);

  return (
    <ThemedView type="backgroundElement" style={styles.chatRow}>
      {isRoom ? (
        <View style={[styles.roomBadge, { backgroundColor: theme.accentSoft }]}>
          <SymbolView
            name={{ ios: 'house.fill', android: 'home', web: 'home' }}
            size={20}
            tintColor={theme.accent}
          />
        </View>
      ) : (
        <Avatar path={chat.photo_path} />
      )}
      <View style={styles.chatRowText}>
        <View style={styles.rowTitle}>
          <ThemedText
            type="callout"
            style={[styles.strong, styles.rowName, unread && styles.rowNameUnread]}
            numberOfLines={1}>
            {chat.title ?? 'Traveler'}
          </ThemedText>
          {chat.pinned ? (
            <SymbolView
              name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
              size={12}
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
              size={12}
              tintColor={theme.textSecondary}
            />
          ) : null}
          {/* When it happened, where every messaging app puts it. The name
              takes flexShrink so a long one truncates instead of pushing the
              time off the row. */}
          {stamp ? (
            <ThemedText
              type="caption"
              themeColor={unread ? 'highlight' : 'textSecondary'}
              style={styles.rowStamp}>
              {stamp}
            </ThemedText>
          ) : null}
        </View>
        <View style={styles.rowPreview}>
          {preview ? (
            <ThemedText
              type="footnote"
              themeColor={unread ? 'text' : 'textSecondary'}
              numberOfLines={1}
              style={styles.rowPreviewText}>
              {preview}
            </ThemedText>
          ) : (
            <View style={styles.rowPreviewText} />
          )}
          {/* One dot for "somebody wrote", a count once there are several.
              It can only ever mean that: the RPC counts human messages that
              have cleared moderation and nothing else. */}
          {unread ? (
            chat.unread_count > 1 ? (
              <View style={[styles.unreadPill, { backgroundColor: theme.highlight }]}>
                <ThemedText
                  type="caption"
                  style={[styles.unreadCount, { color: theme.background }]}>
                  {unreadLabel(chat.unread_count)}
                </ThemedText>
              </View>
            ) : (
              <View style={[styles.unreadDot, { backgroundColor: theme.highlight }]} />
            )
          ) : null}
        </View>
        {isRoom && chat.member_count != null ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {countOf(chat.member_count, 'person', 'people')} here now
            {chat.expires_at
              ? ` · you leave ${new Date(chat.expires_at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}`
              : ''}
          </ThemedText>
        ) : null}
      </View>
      {chat.chat_status !== 'active' ? (
        <ThemedText type="footnote" themeColor="textSecondary">
          closed
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

/** Rooms a signed-out visitor (or a signed-in non-member) can look inside. */
function RoomDiscovery({ cityId }: { cityId: number | null }) {
  const theme = useTheme();
  const { data: rooms = [] } = useCityRooms(cityId);
  if (rooms.length === 0) {
    return null;
  }
  return (
    <>
      <ThemedText type="smallBold" themeColor="textSecondary">
        Rooms near you
      </ThemedText>
      {rooms.map((room) => (
        <PressableScale
          key={room.chat_id}
          scaleTo={0.98}
          onPress={() => router.push(`/room/${room.chat_id}`)}>
          <ThemedView type="backgroundElement" style={styles.chatRow}>
            <View style={[styles.roomBadge, { backgroundColor: theme.accentSoft }]}>
              <SymbolView
                name={{ ios: 'house.fill', android: 'home', web: 'home' }}
                size={20}
                tintColor={theme.accent}
              />
            </View>
            <View style={styles.chatRowText}>
              <ThemedText type="callout" style={styles.strong}>
                {room.name}
              </ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {countOf(room.member_count, 'guest')} here now
              </ThemedText>
            </View>
          </ThemedView>
        </PressableScale>
      ))}
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

function ChatRowLink({ chat }: { chat: ChatListRow }) {
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
      scaleTo={0.98}
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
      <ChatRow chat={chat} />
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
  const theme = useTheme();

  // One-to-one conversations and group rooms are different things people
  // look for at different moments, so they get a switch rather than one
  // scroll that mixes them.
  const inTab = chats.filter((c) => (tab === 'groups' ? c.kind === 'room' : c.kind !== 'room'));
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
              <ThemedText type="footnote" themeColor="textSecondary">
                Hostels run open chats. Have a look before you join.
              </ThemedText>
              <RoomDiscovery cityId={cityId} />
              <SignUpGate reason="Want to join in?" where="chat-tab" cta="Make a profile" />
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
            <Segmented
              options={tabs}
              value={tab}
              onChange={setTab}
              accessibilityLabel="Chats or groups"
            />
          </View>
          {/* The '+' means "one more of whatever you are looking at": a new
              group on Groups, and on Chats the only way a one-to-one chat
              ever starts, which is saying hi to somebody. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={tab === 'groups' ? 'Start a group' : 'Say hi to someone'}
            haptic="light"
            scaleTo={0.92}
            onPress={() => router.push(tab === 'groups' ? '/new-group' : '/travelers')}
            style={[styles.headerAction, { backgroundColor: theme.surface }]}>
            <SymbolView
              name={{ ios: 'plus', android: 'add', web: 'add' }}
              size={18}
              tintColor={theme.accent}
            />
          </PressableScale>
          <AvatarButton />
        </View>

        {requests.length > 0 && tab === 'individual' ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
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
        {tab === 'individual' && waitingOnThem.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              You said hi
            </ThemedText>
            {waitingOnThem.map((request) => (
              <SentHelloRow key={request.id} request={request} />
            ))}
          </>
        ) : null}

        {pinned.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Pinned
            </ThemedText>
            {pinned.map((chat) => (
              <ChatRowLink key={chat.chat_id} chat={chat} />
            ))}
          </>
        ) : null}

        {rest.length > 0 ? (
          <>
            {/* Only a heading when there is something above it to be
                separated from. The segment already says "Chats"; repeating
                it directly underneath is a label labelling itself. */}
            {requests.length > 0 || pinned.length > 0 ? (
              <ThemedText type="smallBold" themeColor="textSecondary">
                {tab === 'groups' ? 'Groups' : 'Chats'}
              </ThemedText>
            ) : null}
            {rest.map((chat) => (
              <ChatRowLink key={chat.chat_id} chat={chat} />
            ))}
          </>
        ) : null}

        {/* A failed fetch is not an empty inbox. Somebody with six
            conversations, offline, was being told they had none. */}
        {chatsQuery.isError ? (
          <LoadError compact what="your chats" error={chatsQuery.error} onRetry={refresh} />
        ) : null}
        {/* Same for the hellos waiting on you: silence here used to let "No
            chats yet" render over people who were actually waiting. */}
        {requestsQuery.isError && !chatsQuery.isError ? (
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
              {tab === 'groups' ? 'No groups yet' : 'No chats yet'}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {tab === 'groups'
                ? 'Join a hostel chat below, or start your own.'
                : 'Say hi to someone going your way. The chat opens when they answer.'}
            </ThemedText>
            {tab === 'individual' ? (
              <PrimaryButton label="Find travelers" onPress={() => router.push('/travelers')} />
            ) : null}
          </ThemedView>
        ) : null}

        {tab === 'groups' ? (
          <>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Join a group with an invite code"
              haptic="light"
              scaleTo={0.98}
              onPress={promptForInvite}>
              <ThemedView type="backgroundElement" style={styles.chatRow}>
                <View style={styles.chatRowText}>
                  <ThemedText type="callout">Have an invite?</ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Paste the code somebody sent you.
                  </ThemedText>
                </View>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={14}
                  tintColor={theme.textSecondary}
                />
              </ThemedView>
            </PressableScale>
            <RoomDiscovery cityId={cityId} />
          </>
        ) : null}

        {archived.length > 0 ? (
          <PressableScale scaleTo={0.98} onPress={() => router.push('/archived-chats')}>
            <ThemedView type="backgroundElement" style={styles.chatRow}>
              <View style={styles.chatRowText}>
                <ThemedText type="callout">Archived</ThemedText>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {archived.length} chat{archived.length === 1 ? '' : 's'} · still readable
                </ThemedText>
              </View>
            </ThemedView>
          </PressableScale>
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
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  strong: {
    fontWeight: '600',
  },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 2,
    paddingLeft: 2,
  },
  swipeAction: {
    width: 68,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  feelsOff: {
    textDecorationLine: 'underline',
  },
  sentTag: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
    borderRadius: Radius.pill,
  },
  /* The name gives way first, so a long one truncates rather than pushing
     the timestamp off the end of the row. */
  rowName: {
    flexShrink: 1,
  },
  rowNameUnread: {
    fontWeight: '700',
  },
  /* marginLeft:auto rather than flex:1 — the pin and mute glyphs sit between
     the name and the stamp, and flex would stretch the gap around them. */
  rowStamp: {
    marginLeft: 'auto',
    paddingLeft: Spacing.two,
  },
  rowPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  rowPreviewText: {
    flex: 1,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
  },
  chatRowText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.7,
  },
});
