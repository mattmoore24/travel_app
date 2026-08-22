import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
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
import { KeyboardFloor } from '@/components/ui/keyboard-floor';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { LoadError } from '@/components/ui/load-error';
import { Radius, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import {
  useBlockUser,
  useMessages,
  useDiscardFailed,
  useSendMessage,
  useSendPhoto,
  useLeaveChat,
} from '@/features/chat/hooks';
import { MessageThread } from '@/features/chat/message-thread';
import type { ThreadMessage } from '@/features/chat/outgoing';
import { anchorStartedFrom } from '@/features/chat/anchors';
import { useMarkReadWhileOpen } from '@/features/chat/use-mark-read';
import { useMyChats, useUnlockedSocialHandles } from '@/features/matching/hooks';
// Reactions are chat-shaped, not room-shaped: the table and the summary RPC
// take any chat id, so direct chats reuse exactly what rooms use.
import { useReactions, useToggleReaction, useUnsendMessage } from '@/features/rooms/hooks';
import { useOwnUserId, usePhotoUrl, usePublicProfile } from '@/features/profile/hooks';
import { platformLabel, usesAt } from '@/features/profile/social-handles-editor';
import { useTheme } from '@/hooks/use-theme';
import type { ChatListRow } from '@/lib/database.types';

function ChatHeader({ chat }: { chat: ChatListRow }) {
  const theme = useTheme();
  const { data: photoUrl } = usePhotoUrl(chat.photo_path);
  // my_chats() carries the name and the photo but not the badge, and this is
  // one row the client already has cached from the profile screen.
  const { data: other } = usePublicProfile(chat.other_user_id);
  const block = useBlockUser();
  const leaveChat = useLeaveChat();

  const confirmBlock = () => {
    Alert.alert(
      `Block ${chat.title ?? 'this traveler'}?`,
      'They disappear from the map and from Travelers, can never message you, and this conversation freezes. They are not told.',
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
        {/* The third place trust is spent, after the Travelers hero and the
            profile: this is the screen where somebody decides whether to
            actually go and meet a stranger. */}
        {other?.verified ? <VerifiedSeal size={13} name={chat.title} age={other.age} /> : null}
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
          .map((h) => `${platformLabel(h.platform)} ${usesAt(h.platform) ? '@' : ''}${h.handle}`)
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
  const discardFailed = useDiscardFailed(chat?.chat_id ?? null);
  const sendPhoto = useSendPhoto(chat?.chat_id ?? '');
  const { data: reactions = [] } = useReactions(chat?.chat_id ?? null);
  const toggleReaction = useToggleReaction(chat?.chat_id ?? '');
  const unsend = useUnsendMessage(chat?.chat_id ?? '');
  // Opening a conversation is what "reading" means; so is being in it
  // when the next message lands.
  useMarkReadWhileOpen(chat?.chat_id ?? null, messagesQuery.data?.[0]?.created_at ?? null);
  const [draft, setDraft] = useState('');
  // A picked photo waits here until it is actually sent. It used to fly off
  // the moment the picker closed, with no preview and no way to change your
  // mind — which is not how any messaging app behaves.
  const [attachment, setAttachment] = useState<string | null>(null);

  if (!chat) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.loading}>
          {chatsQuery.isError ? (
            // Not "Chat not found": a failed fetch used to render nothing at
            // all here, so tapping a push notification offline opened a blank
            // dark screen with no message and no way forward.
            <LoadError
              what="this conversation"
              error={chatsQuery.error}
              onRetry={() => chatsQuery.refetch()}
            />
          ) : chatsQuery.isSuccess ? (
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

  const busy = sendMessage.isPending || sendPhoto.isPending;
  const canSend = (draft.trim().length > 0 || attachment != null) && !busy;

  const submit = async () => {
    if (!canSend) {
      return;
    }
    const body = draft.trim();
    try {
      // Photo first so it reads above its caption, and as its own message
      // because a photo goes through moderation and text does not.
      if (attachment) {
        await sendPhoto.mutateAsync(attachment);
        setAttachment(null);
      }
      if (body.length > 0) {
        // Cleared BEFORE the round trip, not after. The bubble is already on
        // screen (optimistically), so leaving the words in the box as well
        // shows the same sentence twice and makes send feel like it did not
        // take. A failure keeps them in the failed bubble, not in the field.
        setDraft('');
        await sendMessage.mutateAsync(body);
      }
    } catch {
      // Surfaced by the failed bubble in the thread, which keeps the words
      // and offers a retry — a modal alert on top of that is noise.
    }
  };

  // Retry: drop the failed bubble and send the same words again, which
  // produces a fresh "Sending" bubble in its place.
  const retry = (message: ThreadMessage) => {
    const body = message.body ?? '';
    discardFailed(message.id);
    if (body.length > 0) {
      sendMessage.mutate(body);
    }
  };

  const confirmUnsend = (messageId: string) => {
    Alert.alert('Unsend this message?', 'It disappears for both of you.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Unsend', style: 'destructive', onPress: () => unsend.mutate(messageId) },
    ]);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <KeyboardFloor>
          <ChatHeader chat={chat} />
          {chat.other_user_id ? <SocialsCard userId={chat.other_user_id} /> : null}
          {/* The chat row can be served from cache while the messages call
              fails, and then the conversation reads as empty rather than as
              unloaded. */}
          {messagesQuery.isError ? (
            <LoadError
              compact
              what="the rest of this conversation"
              error={messagesQuery.error}
              onRetry={() => messagesQuery.refetch()}
            />
          ) : null}
          <MessageThread
            messages={thread}
            ownUserId={ownUserId}
            otherName={chat.title}
            onRetry={retry}
            // Above the oldest bubble (the list is inverted, so a footer is
            // the top). The chat opens on the same context the recipient had
            // when they decided to accept, instead of on a reply to nothing.
            footer={
              chat.first_message_element ? (
                <View style={styles.anchorRow}>
                  <ThemedView type="backgroundElement" style={styles.anchorCard}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {anchorStartedFrom(chat.first_message_element, chat.title)}
                    </ThemedText>
                  </ThemedView>
                </View>
              ) : null
            }
            reactions={reactions}
            onToggleReaction={(messageId, emoji, on) =>
              toggleReaction.mutate({ messageId, emoji, on })
            }
            onUnsend={confirmUnsend}
            onReport={(messageId) =>
              router.push({
                pathname: '/report',
                params: {
                  userId: chat.other_user_id,
                  context: `chat:${chat.chat_id}:message:${messageId}`,
                },
              })
            }
          />
          {closed ? (
            <ThemedView type="backgroundElement" style={styles.closedNotice}>
              <ThemedText type="small" themeColor="textSecondary">
                This chat is closed, so you can&apos;t reply.
              </ThemedText>
            </ThemedView>
          ) : (
            <View>
              {attachment ? (
                <View style={styles.attachmentRow}>
                  <View style={styles.attachment}>
                    <Image source={{ uri: attachment }} style={styles.fill} contentFit="cover" />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Remove photo"
                      hitSlop={8}
                      onPress={() => setAttachment(null)}
                      style={styles.attachmentRemove}>
                      <SymbolView
                        name={{ ios: 'xmark.circle.fill', android: 'cancel', web: 'cancel' }}
                        size={22}
                        tintColor={theme.text}
                      />
                    </Pressable>
                  </View>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Tap send when you&apos;re ready.
                  </ThemedText>
                </View>
              ) : null}
              <View style={styles.composer}>
                <PhotoButton
                  busy={sendPhoto.isPending}
                  disabled={attachment != null}
                  onPick={setAttachment}
                />
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      backgroundColor: theme.surfaceSunken,
                      fontFamily: Fonts?.sans,
                    },
                  ]}
                  placeholder={attachment ? 'Add a message…' : 'Message…'}
                  placeholderTextColor={theme.textSecondary}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                  maxLength={2000}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  // 40pt drawn, 44pt to hit.
                  hitSlop={2}
                  onPress={submit}
                  disabled={!canSend}
                  style={[
                    styles.sendButton,
                    { backgroundColor: theme.accentDeep, opacity: canSend ? 1 : 0.4 },
                  ]}>
                  <SymbolView
                    name={{ ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' }}
                    size={18}
                    tintColor={theme.onAccentDeep}
                  />
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardFloor>
      </SafeAreaView>
    </ThemedView>
  );
}

/**
 * What the hello was answering, in a sentence.
 *
 * Deliberately never quotes the profile back: a bio can change, a photo can
 * come down, and a chat is not the place a stale copy of either should live
 * on. Naming the KIND of thing is enough to make the first message make
 * sense again.
 */

const styles = StyleSheet.create({
  anchorRow: {
    alignItems: 'center',
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  anchorCard: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.xl,
  },
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
    borderRadius: Radius.lg,
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
    borderRadius: Radius.lg,
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
    borderRadius: Radius.lg,
    alignItems: 'center',
  },
  attachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  attachment: {
    width: 72,
    height: 72,
    borderRadius: 12,
    overflow: 'hidden',
  },
  attachmentRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
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
    borderRadius: Radius.lg,
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
