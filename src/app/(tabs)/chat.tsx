import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { AvatarButton } from '@/components/ui/avatar-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Segmented } from '@/components/ui/segmented';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useIsGuest } from '@/features/guest/hooks';
import { useLaunchCities } from '@/features/pins/hooks';
import { rowTimestamp, unreadLabel } from '@/features/chat/separators';
import { useLiveChatList } from '@/features/chat/hooks';
import { waitingInSegment } from '@/features/chat/unread';
import { useChatPref, useCityRooms } from '@/features/rooms/hooks';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { BottomTabInset, HitTarget, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useIncomingRequests, useMyChats, useRespondToRequest } from '@/features/matching/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import { haptics } from '@/lib/haptics';
import type { ChatListRow, IncomingRequestRow } from '@/lib/database.types';
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
              <SymbolView
                name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                size={14}
                tintColor={theme.tint}
              />
            ) : null}
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {request.profile_element ? `about ${describeElement(request.profile_element)} · ` : ''}
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

function describeElement(element: string): string {
  if (element.startsWith('photo')) {
    return 'your photo';
  }
  if (element === 'languages') {
    return 'your languages';
  }
  if (element === 'home') {
    return 'where you are from';
  }
  if (element === 'trip') {
    return 'your travel plans';
  }
  return 'your bio';
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
            {chat.member_count} here now
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
                {room.member_count} guests here now
              </ThemedText>
            </View>
          </ThemedView>
        </PressableScale>
      ))}
    </>
  );
}

/** A row plus its long-press actions — pin, mute, archive (docs/DESIGN.md). */
function ChatRowLink({ chat }: { chat: ChatListRow }) {
  const pref = useChatPref();
  const state = [chat.pinned ? 'pinned' : null, chat.muted ? 'muted' : null].filter(Boolean);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        state.length > 0
          ? `${chat.title ?? 'Conversation'}, ${state.join(' and ')}`
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
    Alert.prompt('Invite code', 'Paste the code from the invite.', [
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
  // Destructured because a query RESULT is a new object every render while
  // its refetch is stable — which is what lets `refresh` be a stable
  // dependency instead of re-firing the focus effect on every pass.
  const { refetch: refetchChats } = chatsQuery;
  const { refetch: refetchRequests } = requestsQuery;
  const refresh = useCallback(() => {
    refetchChats();
    refetchRequests();
  }, [refetchChats, refetchRequests]);

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
                Hostels run open chats for their guests. Have a look before you join one.
              </ThemedText>
              <RoomDiscovery cityId={cityId} />
            </>
          ) : (
            <ThemedText type="footnote" themeColor="textSecondary">
              One-to-one chats start when you say hi to someone and they answer.
            </ThemedText>
          )}
          <SignUpGate reason="Want to join in?" cta="Make a profile" />
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
            accessibilityLabel={tab === 'groups' ? 'Start a group' : 'Find someone to say hi to'}
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

        {/* Empty states are invitations: name the one next action. */}
        {!chatsQuery.isError &&
        inTab.length === 0 &&
        (tab === 'groups' || requests.length === 0) ? (
          <ThemedView type="backgroundElement" style={styles.emptyCard}>
            <ThemedText type="callout">
              {tab === 'groups' ? 'No groups yet' : 'No chats yet'}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {tab === 'groups'
                ? 'Join a hostel chat below, or start a group with people you have met.'
                : 'Find someone going where you are going and say hi. The chat opens once they answer.'}
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
    borderRadius: Spacing.four,
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
    borderRadius: Spacing.three,
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
    borderRadius: Spacing.three,
  },
  chatRowText: {
    flex: 1,
    gap: 2,
  },
  pressed: {
    opacity: 0.7,
  },
});
