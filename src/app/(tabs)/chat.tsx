import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useIsGuest } from '@/features/guest/hooks';
import { useLaunchCities } from '@/features/pins/hooks';
import { useChatPref, useCityRooms } from '@/features/rooms/hooks';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
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
  return 'your bio';
}

function ChatRow({ chat }: { chat: ChatListRow }) {
  const theme = useTheme();
  const preview = chat.last_message ?? chat.first_message;
  const isRoom = chat.kind === 'room';

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
          <ThemedText type="callout" style={styles.strong} numberOfLines={1}>
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
        </View>
        {preview ? (
          <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
            {preview}
          </ThemedText>
        ) : null}
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
  return (
    <PressableScale
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

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const isGuest = useIsGuest();
  const { data: requests = [] } = useIncomingRequests();
  const { data: chats = [] } = useMyChats();
  const { data: launchCities = [] } = useLaunchCities();
  const { data: archived = [] } = useMyChats(true);
  const cityId = launchCities[0]?.city_id ?? null;
  const pinned = chats.filter((c) => c.pinned);
  const rest = chats.filter((c) => !c.pinned);

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
        title="Inbox"
        phase="waiting on backend keys"
        description="Requests and chats show up here once Supabase keys are in .env."
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
          <ThemedText type="title">Chat</ThemedText>
          <ThemedText type="footnote" themeColor="textSecondary">
            Hostels run open chats for their guests. Have a look before you join one.
          </ThemedText>
          <RoomDiscovery cityId={cityId} />
          <SignUpGate reason="Want to join in?" cta="Make a profile" />
        </ScrollView>
      </ThemedView>
    );
  }

  if (requests.length === 0 && chats.length === 0) {
    // Empty states are invitations: name the one next action.
    return (
      <PlaceholderScreen
        icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
        title="Inbox"
        phase="nothing here yet"
        description="Find someone going where you are going and say hi. Chats open once they accept.">
        <PrimaryButton label="Find travelers" onPress={() => router.push('/travelers')} />
      </PlaceholderScreen>
    );
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.four, paddingBottom: BottomTabInset + Spacing.six },
        ]}>
        <ThemedText type="title">Chat</ThemedText>

        {requests.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Requests
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
            <ThemedText type="smallBold" themeColor="textSecondary">
              Chats
            </ThemedText>
            {rest.map((chat) => (
              <ChatRowLink key={chat.chat_id} chat={chat} />
            ))}
          </>
        ) : null}

        <RoomDiscovery cityId={cityId} />

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
