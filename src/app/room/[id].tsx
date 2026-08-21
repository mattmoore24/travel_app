import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { KeyboardFloor } from '@/components/ui/keyboard-floor';
import { LoadError } from '@/components/ui/load-error';
import { PhotoButton } from '@/components/ui/photo-button';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useSendMessage, useSendPhoto } from '@/features/chat/hooks';
import { useIsGuest } from '@/features/guest/hooks';
import { useOwnUserId } from '@/features/profile/hooks';
import { useGroup } from '@/features/groups/hooks';
import { useMyChats } from '@/features/matching/hooks';
import { MessageThread } from '@/features/chat/message-thread';
import {
  useJoinRoom,
  useLeaveRoom,
  useReactions,
  useRemoveRoomMessage,
  useRoomMessages,
  useToggleReaction,
  useUnsendMessage,
} from '@/features/rooms/hooks';
import { addDays, formatDateRange, toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const isGuest = useIsGuest();
  const ownId = useOwnUserId();
  const messagesQuery = useRoomMessages(id ?? null);
  const messages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);
  const chatsQuery = useMyChats();
  const join = useJoinRoom(id!);
  const { data: allReactions = [] } = useReactions(id ?? null);
  const [departure, setDeparture] = useState(addDays(new Date(), 3));
  const [pickingDeparture, setPickingDeparture] = useState(false);
  const leave = useLeaveRoom(id!);
  const send = useSendMessage(id!);
  const sendPhoto = useSendPhoto(id!);
  const toggle = useToggleReaction(id!);
  const unsend = useUnsendMessage(id!);
  const removeMessage = useRemoveRoomMessage(id!);
  const [draft, setDraft] = useState('');

  const membership = useMemo(
    () => chatsQuery.data?.find((c) => c.chat_id === id) ?? null,
    [chatsQuery.data, id]
  );
  const isMember = membership != null;
  // A traveler group, as opposed to a hostel's room. Null for the latter,
  // which is exactly what tells the two apart on this screen.
  const { data: group } = useGroup(membership?.kind === 'room' ? (id ?? null) : null);
  const isGroup = group != null;
  // The database refuses the insert anyway; this is so the person is told
  // why instead of watching Send do nothing.
  const muted = isGroup && group.speaking === 'granted' && membership?.my_role === 'member';
  const isModerator = membership?.my_role === 'admin';

  // The shared thread speaks MessageRow. A room row carries three things it
  // does not — who sent it by name, their photo, and whether a moderator took
  // it down — so those are looked up by id rather than widened into the type
  // every direct chat would then have to carry.
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const thread = useMemo(
    () =>
      messages.map((m) => ({
        id: m.id,
        chat_id: id!,
        sender_id: m.sender_id,
        body: m.body,
        image_path: m.image_path,
        created_at: m.created_at,
      })),
    [messages, id]
  );

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
        <KeyboardFloor>
          <View style={styles.header}>
            <View style={styles.headerRow}>
              <ThemedText type="headline" style={styles.headerTitle} numberOfLines={1}>
                {membership?.title ?? 'Guest room'}
              </ThemedText>
              {/* Leaving lives up here, not under the composer — a destructive
                  action one thumb-width from Send is an accident waiting. */}
              {isGroup ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Group details"
                  onPress={() => router.push(`/group/${id}`)}
                  hitSlop={8}>
                  <SymbolView
                    name={{ ios: 'info.circle', android: 'info', web: 'info' }}
                    size={20}
                    tintColor={theme.text}
                  />
                </Pressable>
              ) : isMember ? (
                <Pressable accessibilityRole="button" onPress={confirmLeave} hitSlop={8}>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Leave
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            {/* While the list is still loading — which it is for a beat right
                after a group is created, since creating one invalidates it —
                say nothing rather than "anyone can read this chat", which is
                both wrong and alarming for a private group. */}
            {chatsQuery.isPending ? null : isMember && membership?.expires_at ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {membership.member_count} here
                {/* A private group is not readable by passers-by, and saying
                    it is would be worse than saying nothing. */}
                {isGroup ? '' : ' · anyone can read'} · you leave{' '}
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

          {/* The same thread a one-to-one chat uses, so a group gets the
              anchored long-press menu rather than the slab this screen used
              to put in the middle of the screen. What a group adds is who
              said it and what a host took down. */}
          <MessageThread
            messages={thread}
            ownUserId={ownId}
            reactions={allReactions}
            canReact={isMember}
            authorFor={(m) => byId.get(m.id)?.display_name ?? 'Someone'}
            noteFor={(m) => (byId.get(m.id)?.removed ? 'Message removed by the host' : null)}
            onToggleReaction={(messageId, emoji, on) => toggle.mutate({ messageId, emoji, on })}
            onUnsend={(messageId) =>
              Alert.alert('Unsend this message?', 'It disappears for everyone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Unsend',
                  style: 'destructive',
                  onPress: () => unsend.mutate(messageId),
                },
              ])
            }
            // A moderator takes a message down; everybody else reports it.
            // Both used to arrive here, so a moderator's button said "Report"
            // and opened a confirmation headed "Remove this message?" — and,
            // worse, an ordinary member got no second action at all. A group
            // is where you meet strangers, so it is exactly where reporting
            // has to work. From a profile still works too; this is the one
            // that carries the message with it.
            reportLabel={isModerator ? 'Remove' : 'Report'}
            onReport={
              isModerator
                ? (messageId) =>
                    Alert.alert(
                      'Remove this message?',
                      'It disappears for everyone in the group.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => removeMessage.mutate(messageId),
                        },
                      ]
                    )
                : (messageId) => {
                    const sender = byId.get(messageId)?.sender_id;
                    if (!sender) {
                      return;
                    }
                    router.push({
                      pathname: '/report',
                      params: { userId: sender, context: `room:${id}:message:${messageId}` },
                    });
                  }
            }
            emptyState={
              messagesQuery.isError ? (
                <LoadError
                  compact
                  what="this room"
                  error={messagesQuery.error}
                  onRetry={() => messagesQuery.refetch()}
                />
              ) : messagesQuery.isPending ? null : (
                <View style={styles.emptyThread}>
                  <ThemedText type="callout" themeColor="textSecondary">
                    {isGroup ? 'Nobody has said anything yet.' : 'Nothing here yet.'}
                  </ThemedText>
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {muted ? 'You will see it here when they do.' : 'Go first. One line is plenty.'}
                  </ThemedText>
                </View>
              )
            }
          />

          {chatsQuery.isPending ? null : isGuest ? (
            <View style={styles.footer}>
              <SignUpGate reason="Join this room to post" cta="Create an account" compact />
            </View>
          ) : muted ? (
            <View style={styles.footer}>
              <ThemedView type="backgroundElement" style={styles.mutedNotice}>
                <ThemedText type="small" themeColor="textSecondary">
                  Only the admin and the people they pick can post here right now. You can read
                  everything and react.
                </ThemedText>
              </ThemedView>
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
                  testID="room-composer"
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
                When are you checking out? You leave the room a week after that.
              </ThemedText>
              {/* The real date, not three guesses at it: people know their
                  checkout day, and picking "7 days" when you mean Thursday
                  is worse than useless. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Choose your checkout date"
                haptic="light"
                scaleTo={0.98}
                onPress={() => setPickingDeparture((open) => !open)}
                style={[styles.dateField, { backgroundColor: theme.surfaceSunken }]}>
                <ThemedText type="caption" themeColor="textSecondary">
                  CHECKING OUT
                </ThemedText>
                <ThemedText type="callout">
                  {formatDateRange(toISODate(departure), toISODate(departure))}
                </ThemedText>
              </PressableScale>
              {pickingDeparture ? (
                <DateTimePicker
                  value={departure}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  minimumDate={new Date()}
                  accentColor={theme.accent}
                  onChange={(_event, selected) => {
                    if (selected) {
                      setDeparture(selected);
                    }
                    if (Platform.OS !== 'ios') {
                      setPickingDeparture(false);
                    }
                  }}
                />
              ) : null}
              <PrimaryButton
                label="Join this room"
                loading={join.isPending}
                onPress={() => submitJoin(departure)}
              />
            </View>
          )}
        </KeyboardFloor>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  dateField: {
    gap: 2,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
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
  messageBody: {
    flexShrink: 1,
    gap: Space.xs,
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
  reactionRow: {
    flexDirection: 'row',
    gap: Space.xs,
  },
  reactionPill: {
    borderRadius: Radius.pill,
    paddingHorizontal: Space.sm,
    paddingVertical: 2,
  },
  mutedNotice: {
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  emptyThread: {
    alignItems: 'center',
    gap: Space.xs,
    paddingVertical: Space.xxl,
    // The list is inverted, so its own children come out mirrored.
    transform: [{ scaleY: -1 }],
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
