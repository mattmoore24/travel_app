import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardDoneBar } from '@/components/form/keyboard-done-bar';
import { Composer } from '@/features/chat/composer';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { KeyboardFloor } from '@/components/ui/keyboard-floor';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { LoadError } from '@/components/ui/load-error';
import { Radius, MaxContentWidth, Spacing } from '@/constants/theme';
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
import { footerAnchor } from '@/features/chat/anchors';
import { useMarkReadWhileOpen } from '@/features/chat/use-mark-read';
import { useMyChats, useUnlockedSocialHandles } from '@/features/matching/hooks';
// Reactions are chat-shaped, not room-shaped: the table and the summary RPC
// take any chat id, so direct chats reuse exactly what rooms use.
import {
  useChatPref,
  useReactions,
  useToggleReaction,
  useUnsendMessage,
} from '@/features/rooms/hooks';
import { useOwnUserId, usePhotoUrl, usePublicProfile } from '@/features/profile/hooks';
import { platformLabel, usesAt } from '@/features/profile/social-handles-editor';
import { useTheme } from '@/hooks/use-theme';
import { useBusinessForChat, useIsBusiness, useIsPlaceChat } from '@/features/business/hooks';
import { useBusinessPhotoUrl } from '@/features/business/photo-url';
import type { ChatListRow } from '@/lib/database.types';

function ChatHeader({ chat }: { chat: ChatListRow }) {
  const theme = useTheme();
  // A conversation with a PLACE is not a conversation with a person, and it
  // was dressed as one: `my_chats` hands back the place's cover photo, which
  // usePhotoUrl signs against `profile-photos` and so comes back a 404
  // wearing a valid-looking URL; `other_user_id` is the owner's auth id, and
  // pushing that at /profile opens their stub personal profile rather than
  // the bar. Both halves branch on this — which is a question about the
  // READER, not just the row. See useIsPlaceChat.
  const isPlace = useIsPlaceChat(chat.kind);
  const { data: personPhotoUrl } = usePhotoUrl(isPlace ? null : chat.photo_path);
  const { data: placePhotoUrl } = useBusinessPhotoUrl(isPlace ? chat.photo_path : null);
  const photoUrl = isPlace ? placePhotoUrl : personPhotoUrl;
  const { data: placeId } = useBusinessForChat(isPlace ? chat.chat_id : null);
  // my_chats() carries the name and the photo but not the badge, and this is
  // one row the client already has cached from the profile screen.
  const { data: other } = usePublicProfile(isPlace ? null : chat.other_user_id);
  // The other half of the same question. When the READER is the business,
  // the person who wrote in is a traveler and every traveler control on this
  // header pointed somewhere a business account cannot go: /profile/[userId]
  // sits behind `signedIn && onboarded` in app/_layout, which is never true
  // for a business, so the tap on the customer's name did nothing at all.
  const viewerIsBusiness = useIsBusiness();
  const block = useBlockUser();
  const leaveChat = useLeaveChat();
  const pref = useChatPref();

  const confirmBlock = () => {
    Alert.alert(
      `Block ${chat.title ?? 'this traveler'}?`,
      viewerIsBusiness
        ? // The traveler version of this promises two things a business does
          // not have: it is not on the map as a person and it has no
          // Travelers tab. What a block actually does from here is close the
          // conversation, which is all this should ever have claimed.
          'They cannot write to you again, and this chat freezes. They are not told.'
        : "They're gone from the map and Travelers, can't message you, and this chat freezes. They're not told.",
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
    Alert.alert('Leave this chat?', "Deletes it for both of you. Can't be undone.", [
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
    ]);
  };

  /**
   * What a business does with a finished conversation.
   *
   * NOT "Leave chat". That calls unmatch_chat, which hard-deletes the whole
   * conversation for the traveler as well — a business tidying its inbox
   * would have wiped a customer's copy of what it told them, from a menu item
   * named for a feature a business does not have. Archiving is per-reader:
   * the thread leaves this inbox and stays readable under Archived, and the
   * traveler's side is untouched.
   */
  const archiveChat = () => {
    pref.mutate({ chatId: chat.chat_id, archived: true });
    router.back();
  };

  const openMenu = () => {
    const items: { label: string; destructive?: boolean; run: () => void }[] = [
      // A business has no traveler profile to open, and neither does the
      // route: pushing /profile/[userId] from here was a tap that did
      // nothing, in the screen a business uses most.
      ...(viewerIsBusiness
        ? []
        : [{ label: 'View profile', run: () => router.push(`/profile/${chat.other_user_id}`) }]),
      {
        label: 'Report',
        run: () =>
          router.push({
            pathname: '/report',
            params: { userId: chat.other_user_id, context: `chat:${chat.chat_id}` },
          }),
      },
      { label: 'Block', destructive: true, run: confirmBlock },
      viewerIsBusiness
        ? { label: 'Archive', run: archiveChat }
        : { label: 'Leave chat', destructive: true, run: confirmLeaveChat },
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...items.map((item) => item.label), 'Cancel'],
          destructiveButtonIndex: items.findIndex((item) => item.destructive),
          cancelButtonIndex: items.length,
        },
        (index) => items[index]?.run()
      );
    } else {
      // Simple fallback for non-iOS dev targets.
      Alert.alert('Options', undefined, [
        ...items.map((item) => ({
          text: item.label,
          style: item.destructive ? ('destructive' as const) : undefined,
          onPress: item.run,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  // Where the name at the top of the screen goes, or null when it goes
  // nowhere. A business reading its own inbox is the null case: the name
  // belongs to a traveler, and a traveler's profile is not a screen a
  // business account has. It stays a plain heading, which is honest.
  const openIdentity = viewerIsBusiness
    ? null
    : isPlace
      ? placeId != null
        ? () => router.push({ pathname: '/place/[id]', params: { id: placeId } })
        : null
      : () => router.push(`/profile/${chat.other_user_id}`);

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole={openIdentity ? 'button' : 'header'}
        accessibilityLabel={
          openIdentity
            ? isPlace
              ? `About ${chat.title ?? 'this business'}`
              : 'View profile'
            : undefined
        }
        disabled={openIdentity == null}
        onPress={openIdentity ?? undefined}
        style={styles.headerIdentity}>
        <View style={[styles.headerAvatar, { backgroundColor: theme.backgroundElement }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
          ) : (
            <SymbolView
              name={
                isPlace
                  ? { ios: 'storefront.fill', android: 'storefront', web: 'storefront' }
                  : { ios: 'person.fill', android: 'person', web: 'person' }
              }
              size={16}
              tintColor={theme.textSecondary}
            />
          )}
        </View>
        <View style={styles.headerNames}>
          <ThemedText type="smallBold">
            {chat.title ?? (isPlace ? 'This business' : 'Traveler')}
          </ThemedText>
          {isPlace ? (
            <ThemedText type="caption" themeColor="textSecondary">
              {`The people who run ${chat.title ?? 'it'}`}
            </ThemedText>
          ) : null}
        </View>
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
          Socials didn&apos;t load.
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
  const { id } = useLocalSearchParams<{ id: string }>();
  const ownUserId = useOwnUserId();
  // §7 rule 4, as the business build tightened it: a chat with a business
  // never unlocks anybody's personal handles, in either direction. So for a
  // business reader this card can only ever come back empty, and asking is a
  // round trip for a promise the database already keeps.
  const viewerIsBusiness = useIsBusiness();
  const chatsQuery = useMyChats();
  // Both lists. Archiving a conversation used to make it unreadable: the
  // Archived screen still linked to it, and the thread it opened said "Chat
  // not found." because the chat is, by definition, not in the un-archived
  // list this screen was asking for.
  const archivedQuery = useMyChats(true);
  const chat = [...(chatsQuery.data ?? []), ...(archivedQuery.data ?? [])].find(
    (c) => c.chat_id === id
  );
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
  // A picked photo waits here until it is actually sent. It used to fly off
  // the moment the picker closed, with no preview and no way to change your
  // mind — which is not how any messaging app behaves.

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
          ) : chatsQuery.isSuccess && archivedQuery.isSuccess ? (
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
          {chat.other_user_id && !viewerIsBusiness ? (
            <SocialsCard userId={chat.other_user_id} />
          ) : null}
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
            // A photo the classifier refused is emptied and flagged removed,
            // which in a one-to-one chat left an empty bubble in the thread
            // for both people — the same nothing-there the founder reported
            // in a group. A room already had this; a direct chat did not.
            noteFor={(m) =>
              m.removed_at == null
                ? null
                : m.sender_id === ownUserId
                  ? 'Your photo did not pass our check'
                  : 'Photo removed'
            }
            onRetry={retry}
            // Above the oldest bubble (the list is inverted, so a footer is
            // the top). The chat opens on the same context the recipient had
            // when they decided to accept, instead of on a reply to nothing.
            footer={
              chat.first_message_element ? (
                <View style={styles.anchorRow}>
                  <ThemedView type="backgroundElement" style={styles.anchorCard}>
                    <ThemedText type="caption" themeColor="textSecondary">
                      {footerAnchor(
                        chat.first_message_element,
                        chat.first_message_sender_id,
                        ownUserId,
                        chat.title
                      )}
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
                This chat is closed.
              </ThemedText>
            </ThemedView>
          ) : (
            <Composer
              inputTestID="chat-composer"
              disabled={busy}
              photoBusy={sendPhoto.isPending}
              onSend={async ({ text, photoUri }) => {
                // A photo and the words under it are ONE message. They used
                // to be two, and they arrived in the wrong order: text is
                // delivered immediately and a photo waits for a moderation
                // verdict, so "look at this" landed first and the picture
                // seconds later, underneath it.
                //
                // A photo failure THROWS, so the composer keeps the picture
                // staged and the same one can go again. A text failure does
                // not: the words are already in a failed bubble in the
                // thread, which is where the retry lives.
                if (photoUri) {
                  await sendPhoto.mutateAsync({ localUri: photoUri, body: text });
                  return;
                }
                if (text.length > 0) {
                  try {
                    await sendMessage.mutateAsync(text);
                  } catch {
                    // Surfaced by the failed bubble.
                  }
                }
              }}
            />
          )}
        </KeyboardFloor>
        {/* Outside the scroller: iOS hosts it in the keyboard's own window,
            so where it sits only decides which fields can reach it. */}
        <KeyboardDoneBar />
      </SafeAreaView>
    </ThemedView>
  );
}

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
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  headerNames: {
    flexShrink: 1,
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
