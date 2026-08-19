import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { GlassSurface } from '@/components/ui/glass-surface';
import { PhotoButton } from '@/components/ui/photo-button';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl, useSendMessage, useSendPhoto } from '@/features/chat/hooks';
import { useIsGuest } from '@/features/guest/hooks';
import { useOwnUserId, usePhotoUrl } from '@/features/profile/hooks';
import { useMyChats } from '@/features/matching/hooks';
import {
  useJoinRoom,
  useLeaveRoom,
  useReactions,
  useRoomMessages,
  useToggleReaction,
} from '@/features/rooms/hooks';
import { addDays, toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import type { RoomMessageRow } from '@/lib/database.types';

/** The six that cover almost every reaction; "more" is a follow-up. */
const QUICK_REACTIONS = ['👍', '🙌', '🔥', '😂', '❤️', '👀'];

function Reactions({
  messageId,
  chatId,
  canReact,
}: {
  messageId: string;
  chatId: string;
  canReact: boolean;
}) {
  const theme = useTheme();
  const { data: all = [] } = useReactions(chatId);
  const toggle = useToggleReaction(chatId);
  const mine = all.filter((r) => r.message_id === messageId);
  if (mine.length === 0) {
    return null;
  }
  return (
    <View style={styles.reactionRow}>
      {mine.map((r) => (
        <Pressable
          key={r.emoji}
          disabled={!canReact}
          onPress={() => toggle.mutate({ messageId, emoji: r.emoji, on: !r.reacted_by_me })}>
          <View
            style={[
              styles.reactionPill,
              {
                backgroundColor: r.reacted_by_me ? theme.accentSoft : theme.surfaceSunken,
              },
            ]}>
            <ThemedText type="footnote">
              {r.emoji} {r.count}
            </ThemedText>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function RoomMessage({
  message,
  chatId,
  canReact,
  ownId,
  onLongPress,
}: {
  message: RoomMessageRow;
  chatId: string;
  canReact: boolean;
  ownId: string | null;
  onLongPress: () => void;
}) {
  const theme = useTheme();
  const { data: avatarUrl } = usePhotoUrl(message.photo_path);
  const { data: imageUrl } = useChatPhotoUrl(message.image_path);
  const isOwn = message.sender_id === ownId;

  if (message.removed) {
    return (
      <ThemedText type="footnote" themeColor="textSecondary" style={styles.removed}>
        Message removed by the host
      </ThemedText>
    );
  }

  return (
    <Pressable onLongPress={canReact ? onLongPress : undefined} delayLongPress={250}>
      <View style={[styles.messageRow, isOwn && styles.messageRowOwn]}>
        {!isOwn ? (
          <View style={[styles.avatar, { backgroundColor: theme.surfaceSunken }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.fill} contentFit="cover" />
            ) : null}
          </View>
        ) : null}
        <View style={styles.messageBody}>
          {!isOwn ? (
            <ThemedText type="footnote" themeColor="textSecondary">
              {message.display_name ?? 'Traveler'}
            </ThemedText>
          ) : null}
          <View
            style={[
              styles.bubble,
              { backgroundColor: isOwn ? theme.accent : theme.surfaceSunken },
            ]}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={styles.photo} contentFit="cover" />
            ) : null}
            {message.body ? (
              <ThemedText type="body" style={isOwn ? { color: theme.onAccent } : undefined}>
                {message.body}
              </ThemedText>
            ) : null}
          </View>
          <Reactions messageId={message.id} chatId={chatId} canReact={canReact} />
        </View>
      </View>
    </Pressable>
  );
}

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const isGuest = useIsGuest();
  const ownId = useOwnUserId();
  const { data: messages = [] } = useRoomMessages(id ?? null);
  const { data: chats = [] } = useMyChats();
  const join = useJoinRoom(id!);
  const leave = useLeaveRoom(id!);
  const send = useSendMessage(id!);
  const sendPhoto = useSendPhoto(id!);
  const toggle = useToggleReaction(id!);
  const [draft, setDraft] = useState('');
  const [reactingTo, setReactingTo] = useState<string | null>(null);

  const membership = useMemo(() => chats.find((c) => c.chat_id === id) ?? null, [chats, id]);
  const isMember = membership != null;

  const submitJoin = (departure: Date) => {
    join.mutate(toISODate(departure), {
      onError: () => Alert.alert('Could not join', 'Please try again.'),
    });
  };

  const confirmLeave = () =>
    Alert.alert('Leave this room?', 'You can join again while you are in town.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          leave.mutate();
          router.back();
        },
      },
    ]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <ThemedText type="headline" style={styles.headerTitle} numberOfLines={1}>
                {membership?.title ?? 'Guest room'}
              </ThemedText>
              {/* Leaving lives up here, not under the composer — a destructive
                  action one thumb-width from Send is an accident waiting. */}
              {isMember ? (
                <Pressable accessibilityRole="button" onPress={confirmLeave} hitSlop={8}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Leave
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            {isMember && membership?.expires_at ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {membership.member_count} here · anyone can read · you leave{' '}
                {new Date(membership.expires_at).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}
              </ThemedText>
            ) : (
              <ThemedText type="footnote" themeColor="textSecondary">
                Anyone can read this chat. Join in to post.
              </ThemedText>
            )}
          </View>

          <FlatList
            style={styles.flex}
            inverted
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            renderItem={({ item }) => (
              <RoomMessage
                message={item}
                chatId={id!}
                canReact={isMember}
                ownId={ownId}
                onLongPress={() => setReactingTo(item.id)}
              />
            )}
          />

          {reactingTo ? (
            <GlassSurface variant="clear" radius={Radius.pill} style={styles.reactionBar}>
              <View style={styles.reactionBarInner}>
                {QUICK_REACTIONS.map((emoji) => (
                  <Pressable
                    key={emoji}
                    onPress={() => {
                      toggle.mutate({ messageId: reactingTo, emoji, on: true });
                      setReactingTo(null);
                    }}>
                    <ThemedText type="title">{emoji}</ThemedText>
                  </Pressable>
                ))}
                <Pressable onPress={() => setReactingTo(null)} hitSlop={8}>
                  <SymbolView
                    name={{ ios: 'xmark', android: 'close', web: 'close' }}
                    size={16}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>
              </View>
            </GlassSurface>
          ) : null}

          {isGuest ? (
            <View style={styles.footer}>
              <SignUpGate reason="Join this room to post" cta="Create an account" compact />
            </View>
          ) : isMember ? (
            <View style={styles.composerWrap}>
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
                    { backgroundColor: theme.surfaceSunken, color: theme.text },
                  ]}
                  placeholder="Message the room…"
                  placeholderTextColor={theme.textSecondary}
                  value={draft}
                  onChangeText={setDraft}
                  multiline
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send"
                  disabled={draft.trim().length === 0 || send.isPending}
                  onPress={() => {
                    send.mutate(draft.trim());
                    setDraft('');
                  }}
                  style={[
                    styles.sendButton,
                    {
                      backgroundColor:
                        draft.trim().length === 0 ? theme.surfaceSunken : theme.accent,
                    },
                  ]}>
                  <SymbolView
                    name={{ ios: 'arrow.up', android: 'send', web: 'send' }}
                    size={18}
                    tintColor={draft.trim().length === 0 ? theme.textSecondary : theme.onAccent}
                  />
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.footer}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Joining asks one thing: when you leave. You come out of the room a week after that.
              </ThemedText>
              <View style={styles.joinRow}>
                {[3, 7, 14].map((days) => (
                  <View key={days} style={styles.joinButton}>
                    <PrimaryButton
                      variant={days === 7 ? 'filled' : 'tonal'}
                      label={`${days} days`}
                      loading={join.isPending}
                      onPress={() => submitJoin(addDays(new Date(), days))}
                    />
                  </View>
                ))}
              </View>
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
  },
  flex: {
    flex: 1,
  },
  header: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
  headerTitle: {
    flex: 1,
  },
  messages: {
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.sm,
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageBody: {
    flexShrink: 1,
    gap: Space.xs,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    overflow: 'hidden',
  },
  bubble: {
    borderRadius: Radius.lg,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    overflow: 'hidden',
  },
  photo: {
    width: 220,
    height: 165,
    borderRadius: Radius.sm,
    marginBottom: Space.xs,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
  removed: {
    fontStyle: 'italic',
  },
  reactionRow: {
    flexDirection: 'row',
    gap: Space.xs,
  },
  reactionPill: {
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
  },
  reactionBar: {
    alignSelf: 'center',
    marginBottom: Space.sm,
  },
  reactionBarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm,
  },
  composerWrap: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Space.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: Radius.lg,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    paddingBottom: Space.md,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
  },
  joinRow: {
    flexDirection: 'row',
    gap: Space.sm,
  },
  joinButton: {
    flex: 1,
  },
});
