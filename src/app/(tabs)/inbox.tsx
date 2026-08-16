import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useIncomingRequests, useMyChats, useRespondToRequest } from '@/features/matching/hooks';
import { usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
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

  const act = async (accept: boolean) => {
    try {
      const result = await respond.mutateAsync({ requestId: request.id, accept });
      if (result.accepted && result.chat_id) {
        router.push(`/chat/${result.chat_id}`);
      }
    } catch {
      // Surfaced by the global mutation error alert.
    }
  };

  return (
    <ThemedView type="backgroundElement" style={styles.requestCard}>
      <View style={styles.requestHeader}>
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
          {request.profile_element ? (
            <ThemedText type="small" themeColor="textSecondary">
              about {describeElement(request.profile_element)}
            </ThemedText>
          ) : null}
        </View>
      </View>
      <ThemedText>{request.first_message}</ThemedText>
      <View style={styles.requestActions}>
        <View style={styles.actionButton}>
          <PrimaryButton
            variant="ghost"
            label="Decline"
            disabled={respond.isPending}
            onPress={() => act(false)}
          />
        </View>
        <View style={styles.actionButton}>
          <PrimaryButton label="Accept" loading={respond.isPending} onPress={() => act(true)} />
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
  return (
    <ThemedView type="backgroundElement" style={styles.chatRow}>
      <Avatar path={chat.other_photo_path} />
      <View style={styles.chatRowText}>
        <ThemedText type="smallBold">{chat.other_display_name ?? 'Traveler'}</ThemedText>
        {chat.first_message ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {chat.first_message}
          </ThemedText>
        ) : null}
      </View>
    </ThemedView>
  );
}

export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const { data: requests = [] } = useIncomingRequests();
  const { data: chats = [] } = useMyChats();

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
        title="Inbox"
        phase="waiting on backend keys"
        description="Message requests and chats appear here once Supabase keys are in .env."
      />
    );
  }

  if (requests.length === 0 && chats.length === 0) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'bubble.left.and.bubble.right.fill', android: 'chat', web: 'chat' }}
        title="Inbox"
        phase="all quiet for now"
        description="Message requests land here for you to accept or decline. Chats only open once you accept."
      />
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
        <ThemedText type="subtitle">Inbox</ThemedText>

        {requests.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              REQUESTS · accept to open a chat
            </ThemedText>
            {requests.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </>
        ) : null}

        {chats.length > 0 ? (
          <>
            <ThemedText type="smallBold" themeColor="textSecondary">
              CHATS
            </ThemedText>
            {chats.map((chat) => (
              <Pressable
                key={chat.chat_id}
                onPress={() => router.push(`/chat/${chat.chat_id}`)}
                style={({ pressed }) => pressed && styles.pressed}>
                <ChatRow chat={chat} />
              </Pressable>
            ))}
          </>
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
