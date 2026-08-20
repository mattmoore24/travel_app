import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PhotoButton } from '@/components/ui/photo-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  useBlockUser,
  useMessages,
  useSendMessage,
  useSendPhoto,
  useLeaveChat,
} from '@/features/chat/hooks';
import { MessageThread } from '@/features/chat/message-thread';
import { useMyChats, useUnlockedSocialHandles } from '@/features/matching/hooks';
// Reactions are chat-shaped, not room-shaped: the table and the summary RPC
// take any chat id, so direct chats reuse exactly what rooms use.
import { useReactions, useToggleReaction } from '@/features/rooms/hooks';
import { useOwnUserId, usePhotoUrl } from '@/features/profile/hooks';
import { useTheme } from '@/hooks/use-theme';
import type { ChatListRow } from '@/lib/database.types';

const PLATFORM_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  snapchat: 'Snapchat',
  x: 'X',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  other: 'Other',
};

function ChatHeader({ chat }: { chat: ChatListRow }) {
  const theme = useTheme();
  const { data: photoUrl } = usePhotoUrl(chat.photo_path);
  const block = useBlockUser();
  const leaveChat = useLeaveChat();

  const confirmBlock = () => {
    Alert.alert(
      `Block ${chat.title ?? 'this traveler'}?`,
      'They disappear from your map and matches, can never message you, and this conversation freezes. They are not told.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            if (chat.other_user_id) {
              block.mutate(chat.other_user_id);
            }
          },
        },
      ]
    );
  };

  const confirmLeaveChat = () => {
    Alert.alert(
      'Leave this chat?',
      'This deletes the conversation for both of you. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave chat',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveChat.mutateAsync(chat.chat_id);
              router.back();
            } catch {
              // Surfaced by the global mutation error alert.
            }
          },
        },
      ]
    );
  };

  const openMenu = () => {
    const actions = ['View profile', 'Report', 'Block', 'Leave chat', 'Cancel'];
    const handle = (index: number) => {
      if (index === 0) {
        router.push(`/profile/${chat.other_user_id}`);
      } else if (index === 1) {
        router.push({
          pathname: '/report',
          params: { userId: chat.other_user_id, context: `chat:${chat.chat_id}` },
        });
      } else if (index === 2) {
        confirmBlock();
      } else if (index === 3) {
        confirmLeaveChat();
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: actions, destructiveButtonIndex: 2, cancelButtonIndex: 4 },
        handle
      );
    } else {
      // Simple fallback for non-iOS dev targets.
      Alert.alert('Options', undefined, [
        { text: 'View profile', onPress: () => handle(0) },
        { text: 'Report', onPress: () => handle(1) },
        { text: 'Block', style: 'destructive', onPress: () => handle(2) },
        { text: 'Leave chat', style: 'destructive', onPress: () => handle(3) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="View profile"
        onPress={() => router.push(`/profile/${chat.other_user_id}`)}
        style={styles.headerIdentity}>
        <View style={[styles.headerAvatar, { backgroundColor: theme.backgroundElement }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
          ) : (
            <SymbolView
              name={{ ios: 'person.fill', android: 'person', web: 'person' }}
              size={16}
              tintColor={theme.textSecondary}
            />
          )}
        </View>
        <ThemedText type="smallBold">{chat.title ?? 'Traveler'}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Conversation options"
        onPress={openMenu}
        hitSlop={10}>
        <SymbolView
          name={{ ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }}
          size={22}
          tintColor={theme.text}
        />
      </Pressable>
    </View>
  );
}

function SocialsCard({ userId }: { userId: string }) {
  const theme = useTheme();
  const { data: socials = [], isError } = useUnlockedSocialHandles(userId);
  if (isError) {
    return (
      <ThemedView type="backgroundElement" style={styles.socialsCard}>
        <ThemedText type="small" themeColor="textSecondary">
          Could not load their socials just now.
        </ThemedText>
      </ThemedView>
    );
  }
  if (socials.length === 0) {
    return null;
  }
  return (
    <ThemedView type="backgroundElement" style={styles.socialsCard}>
      <SymbolView
        name={{ ios: 'lock.open.fill', android: 'lock_open', web: 'lock_open' }}
        size={13}
        tintColor={theme.tint}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {socials
          .map((h) => `${PLATFORM_LABELS[h.platform] ?? h.platform} @${h.handle}`)
          .join(' · ')}
      </ThemedText>
    </ThemedView>
  );
}

export default function ChatScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ownUserId = useOwnUserId();
  const chatsQuery = useMyChats();
  const chat = (chatsQuery.data ?? []).find((c) => c.chat_id === id);
  const messagesQuery = useMessages(chat?.chat_id ?? null);
  const sendMessage = useSendMessage(chat?.chat_id ?? null);
  const sendPhoto = useSendPhoto(chat?.chat_id ?? '');
  const { data: reactions = [] } = useReactions(chat?.chat_id ?? null);
  const toggleReaction = useToggleReaction(chat?.chat_id ?? '');
  const [draft, setDraft] = useState('');

  if (!chat) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.loading}>
          {chatsQuery.isSuccess ? (
            <ThemedText themeColor="textSecondary" style={styles.centerText}>
              Chat not found.
            </ThemedText>
          ) : null}
        </SafeAreaView>
      </ThemedView>
    );
  }

  const closed = chat.chat_status !== 'active';
  const messages = messagesQuery.data ?? [];
  // The opening message lives on the chat row rather than in messages, but
  // it is part of the conversation and reads as one (it can be reacted to
  // like any other message once it is a real row; until then it is shown in
  // place, oldest, at the bottom of the inverted list).
  const thread = chat.first_message
    ? [
        ...messages,
        {
          id: `first:${chat.chat_id}`,
          chat_id: chat.chat_id,
          sender_id: chat.first_message_sender_id ?? '',
          body: chat.first_message,
          image_path: null,
          created_at: chat.created_at,
        },
      ]
    : messages;

  const submit = async () => {
    const body = draft.trim();
    if (body.length === 0 || sendMessage.isPending) {
      return;
    }
    try {
      await sendMessage.mutateAsync(body);
      setDraft('');
    } catch {
      // Surfaced by the global mutation error alert; keep the draft.
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          <ChatHeader chat={chat} />
          {chat.other_user_id ? <SocialsCard userId={chat.other_user_id} /> : null}
          <MessageThread
            messages={thread}
            ownUserId={ownUserId}
            reactions={reactions}
            onToggleReaction={(messageId, emoji, on) =>
              toggleReaction.mutate({ messageId, emoji, on })
            }
          />
          {closed ? (
            <ThemedView type="backgroundElement" style={styles.closedNotice}>
              <ThemedText type="small" themeColor="textSecondary">
                This chat is closed, so you can&apos;t reply.
              </ThemedText>
            </ThemedView>
          ) : (
            <View style={styles.composer}>
              <PhotoButton
                busy={sendPhoto.isPending}
                onPick={(uri) =>
                  sendPhoto.mutate(uri, {
                    onError: () =>
                      Alert.alert('Could not send', 'Check your connection and try again.'),
                  })
                }
              />
              <TextInput
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.backgroundElement,
                    fontFamily: Fonts?.sans,
                  },
                ]}
                placeholder="Message…"
                placeholderTextColor={theme.textSecondary}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={2000}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                onPress={submit}
                disabled={draft.trim().length === 0 || sendMessage.isPending}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: theme.tint,
                    opacity: draft.trim().length === 0 || sendMessage.isPending ? 0.4 : 1,
                  },
                ]}>
                <SymbolView
                  name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
                  size={18}
                  tintColor={theme.onTint}
                />
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
  },
  flex: {
    flex: 1,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
  },
  centerText: {
    textAlign: 'center',
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  headerIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  socialsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  messages: {
    padding: Spacing.four,
    gap: Spacing.two,
  },
  firstMessageWrap: {
    gap: Spacing.two,
    marginBottom: Spacing.three,
  },
  messagePhoto: {
    width: 220,
    height: 165,
    borderRadius: 10,
    marginBottom: 4,
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    borderBottomRightRadius: Spacing.one,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    borderBottomLeftRadius: Spacing.one,
  },
  closedNotice: {
    margin: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    alignItems: 'center',
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 15,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
