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
import { useDiscardFailed, useSendMessage, useSendPhoto } from '@/features/chat/hooks';
import { useIsGuest } from '@/features/guest/hooks';
import { useOwnUserId } from '@/features/profile/hooks';
import { useGroup } from '@/features/groups/hooks';
import { useMyChats } from '@/features/matching/hooks';
import { useMarkReadWhileOpen } from '@/features/chat/use-mark-read';
import { MessageThread } from '@/features/chat/message-thread';
import {
  useJoinRoom,
  useLeaveRoom,
  useReactions,
  useRemoveRoomMessage,
  usePinMessage,
  useRoomInfo,
  useRoomPins,
  useUnpinMessage,
  useRoomMessages,
  useToggleReaction,
  useUnsendMessage,
} from '@/features/rooms/hooks';
import { addDays, formatDateRange, toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { countOf } from '@/lib/plural';

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
  const send = useSendMessage(id!, 'room');
  const discardFailed = useDiscardFailed(id!, 'room');
  const sendPhoto = useSendPhoto(id!);
  const toggle = useToggleReaction(id!);
  const unsend = useUnsendMessage(id!);
  const removeMessage = useRemoveRoomMessage(id!);
  const { data: pins = [] } = useRoomPins(id ?? null);
  const pin = usePinMessage(id!);
  const unpin = useUnpinMessage(id!);
  const [draft, setDraft] = useState('');

  const membership = useMemo(
    () => chatsQuery.data?.find((c) => c.chat_id === id) ?? null,
    [chatsQuery.data, id]
  );
  const isMember = membership != null;
  // Only asked when you are NOT already a member: my_chats already answers
  // for everybody else, and a second round trip for a name you have is waste.
  const { data: info } = useRoomInfo(isMember ? null : (id ?? null));
  // Only a member has anything to mark: a visitor previewing a public room
  // has no chat_prefs row and the RPC would refuse them.
  useMarkReadWhileOpen(isMember ? (id ?? null) : null, messages[0]?.created_at ?? null);
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
        // Carried through, or a message that has not left the device yet
        // would look exactly like one that had.
        local: (m as { local?: 'sending' | 'failed' }).local,
      })),
    [messages, id]
  );

  const submitJoin = (departure: Date) => {
    join.mutate(toISODate(departure), {
      onError: () => Alert.alert('Could not join', 'Try again.'),
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
              {/* my_chats() carries the name, but only for members — which
                  is exactly the people who did not need it. A visitor
                  reading a hostel's public preview used to get the literal
                  words "Guest room" on the screen whose whole job is to make
                  the place feel like somewhere you might walk into. */}
              <ThemedText type="headline" style={styles.headerTitle} numberOfLines={1}>
                {membership?.title ?? info?.name ?? 'Guest room'}
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
                {countOf(membership.member_count ?? 0, 'person', 'people')} here
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
                {info ? `${countOf(info.member_count, 'guest')} here. ` : ''}
                Anyone can read this chat. Join in to post.
              </ThemedText>
            )}
          </View>

          {/* What the host has kept at the top. A hostel room is a river:
              the address of tonight's dinner scrolls out of reach in twenty
              minutes and gets asked for four more times. Capped at three and
              always expiring, because the failure mode of pinned content is
              a stale one nobody remembers to take down. */}
          {pins.length > 0 ? (
            <View style={[styles.pinStrip, { borderBottomColor: theme.hairline }]}>
              {pins.map((pinned) => (
                <Pressable
                  key={pinned.message_id}
                  accessibilityRole={isModerator ? 'button' : 'text'}
                  accessibilityLabel={`Pinned: ${pinned.body ?? 'a photo'}`}
                  accessibilityHint={isModerator ? 'Press and hold to unpin' : undefined}
                  onLongPress={
                    isModerator
                      ? () =>
                          Alert.alert('Unpin this?', undefined, [
                            { text: 'Keep it', style: 'cancel' },
                            {
                              text: 'Unpin',
                              onPress: () => unpin.mutate(pinned.message_id),
                            },
                          ])
                      : undefined
                  }
                  style={styles.pinRow}>
                  <SymbolView
                    name={{ ios: 'pin.fill', android: 'push_pin', web: 'push_pin' }}
                    size={12}
                    tintColor={theme.highlight}
                  />
                  <ThemedText type="footnote" numberOfLines={2} style={styles.pinText}>
                    {pinned.body ?? 'Photo'}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* The same thread a one-to-one chat uses, so a group gets the
              anchored long-press menu rather than the slab this screen used
              to put in the middle of the screen. What a group adds is who
              said it and what a host took down. */}
          <MessageThread
            messages={thread}
            ownUserId={ownId}
            reactions={allReactions}
            canReact={isMember}
            onRetry={(message) => {
              const body = message.body ?? '';
              discardFailed(message.id);
              if (body.length > 0) {
                send.mutate(body);
              }
            }}
            authorFor={(m) => byId.get(m.id)?.display_name ?? 'Someone'}
            // A group is where you meet strangers, so knowing WHO said a
            // thing matters more here than anywhere else in the app.
            avatarFor={(m) => byId.get(m.id)?.photo_path ?? null}
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
            // Hosts only, and the menu simply does not carry the action for
            // anybody else — an action you can see and cannot perform is
            // worse than one that was never offered.
            onPin={
              isModerator
                ? (messageId) => {
                    pin.mutate(
                      { messageId },
                      {
                        onError: (error) =>
                          Alert.alert(
                            'Could not pin that',
                            /three pins/i.test((error as Error).message ?? '')
                              ? 'Three is the limit. Unpin one first.'
                              : 'Try that again in a moment.'
                          ),
                      }
                    );
                  }
                : undefined
            }
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
              <SignUpGate
                reason="Join this room to post"
                where="room"
                cta="Create an account"
                compact
              />
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
                  // Not disabled while a send is in flight any more: the
                  // bubble is already on screen, so the composer's job is
                  // done and locking it just stops the next sentence.
                  disabled={draft.trim().length === 0}
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
  pinStrip: {
    gap: Space.xs,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.sm,
  },
  pinText: {
    flex: 1,
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
