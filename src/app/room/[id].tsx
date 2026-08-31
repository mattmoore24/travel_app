import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardDoneBar } from '@/components/form/keyboard-done-bar';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { KeyboardFloor } from '@/components/ui/keyboard-floor';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { Sheet, SHEET_SETTLE_MS, leavingSheet } from '@/components/ui/sheet';
import { MaxContentWidth, NativeAppearance, Radius, Space } from '@/constants/theme';
import { useDiscardFailed, useSendMessage, useSendPhoto } from '@/features/chat/hooks';
import { useIsGuest, useIsGuestAccount, useIsSignedOut } from '@/features/guest/hooks';
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
import { useBusinessForChat, useIsBusiness, useOwnBusiness } from '@/features/business/hooks';
import { Composer } from '@/features/chat/composer';
import { closeDayLabel, finiteDate, useHasGroupClosed } from '@/features/groups/closing';
import { useTheme } from '@/hooks/use-theme';
import { countOf } from '@/lib/plural';

export default function RoomScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const isGuest = useIsGuest();
  const isGuestAccount = useIsGuestAccount();
  // No session at all, as opposed to a guest account that has one. /report
  // sits behind Stack.Protected guard={signedIn}, so for a signed-out
  // visitor the push would do nothing at all; a guest ACCOUNT can report
  // and keeps the real route.
  const isSignedOut = useIsSignedOut();
  const [reportGate, setReportGate] = useState(false);
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
  const sendPhoto = useSendPhoto(id!, 'room');
  const toggle = useToggleReaction(id!);
  const unsend = useUnsendMessage(id!);
  const removeMessage = useRemoveRoomMessage(id!);
  const { data: pins = [] } = useRoomPins(id ?? null);
  const pin = usePinMessage(id!);
  const unpin = useUnpinMessage(id!);

  // Archived rooms too: the Archived screen links straight here, and a room
  // that had been archived resolved to no membership at all - so it offered
  // to let you JOIN a room you are already in.
  const archivedQuery = useMyChats(true);
  const membership = useMemo(
    () =>
      [...(chatsQuery.data ?? []), ...(archivedQuery.data ?? [])].find((c) => c.chat_id === id) ??
      null,
    [chatsQuery.data, archivedQuery.data, id]
  );
  const isMember = membership != null;
  // A business never joins a room — not another business's, and not its own.
  // The founder's rule, and since 20260829190000 the database's too. This is
  // what stops the button being offered in the first place.
  const viewerIsBusiness = useIsBusiness();
  // Only asked when you are NOT already a member: my_chats already answers
  // for everybody else, and a second round trip for a name you have is waste.
  const { data: info } = useRoomInfo(isMember ? null : (id ?? null));
  // A traveler group, as opposed to a hostel's room. Null for the latter,
  // which is exactly what tells the two apart on this screen.
  const { data: group } = useGroup(membership?.kind === 'room' ? (id ?? null) : null);
  const isGroup = group != null;
  // The database refuses the insert anyway; this is so the person is told
  // why instead of watching Send do nothing.
  const muted = isGroup && group.speaking === 'granted' && membership?.my_role === 'member';
  // A group past its last day. can_send_in_chat refuses every write in one,
  // so anything that offers a write has to know — otherwise the refusal
  // arrives as a raw row-level-security sentence in an alert.
  const closed = useHasGroupClosed(isGroup ? (group.max_stay_until ?? null) : null);
  // A place's room, as opposed to a traveler group. `business_for_chat`
  // answers only for the first, so a null here IS the distinction — and it
  // is what gives a traveler a way back to the hours, the address and the
  // rating they joined from. Without it, joining from the map was one-way:
  // the only route back to the place was finding the chip again.
  const { data: chatPlaceId } = useBusinessForChat(isGroup ? null : (id ?? null));
  const ownBusiness = useOwnBusiness().data ?? null;
  // The room this account RUNS, answered without a round trip.
  // `business_for_chat` cannot answer it: that function matches
  // `kind = 'business'`, which is a DM, and a business's public room is
  // `kind = 'room'` — so `chatPlaceId` was null here for everybody and the
  // owner fell through every branch as an ordinary visitor. my_business
  // already carries the chat id, and it is the owner's own row.
  const isOwnRoom = ownBusiness?.chat_id != null && ownBusiness.chat_id === id;
  const placeId = isOwnRoom ? (ownBusiness?.id ?? null) : (chatPlaceId ?? null);
  // The owner has no room_members row — the database refuses one — so
  // `my_role` is null for them and the person who runs the chat was handed
  // "Report" where "Remove" belongs and no pin control at all, while
  // is_room_moderator has answered true for them server-side since
  // 20260827160000.
  const isModerator = membership?.my_role === 'admin' || isOwnRoom;
  // A member has something to mark, and so does the owner of the room:
  // mark_chat_read admits is_room_moderator, which answers true for them.
  // Gated on `isMember` alone, opening the room the business RUNS marked
  // nothing, so the Chat tab's badge counted its own room's messages and
  // never came down. A visitor previewing a public room is still excluded -
  // they have nothing to read up to and the RPC would refuse them.
  useMarkReadWhileOpen(
    isMember || isOwnRoom ? (id ?? null) : null,
    messages[0]?.created_at ?? null
  );

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
        unsent_at: m.unsent_at,
        created_at: m.created_at,
        // The RPC masks image_path until a verdict lands and answers the
        // state separately; the thread asks one question, so map it onto the
        // column a direct chat reads straight off the table.
        moderation_status:
          m.photo_state === 'checking'
            ? ('pending' as const)
            : m.photo_state === 'blocked'
              ? ('rejected' as const)
              : ('approved' as const),
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
              ) : placeId != null ? (
                // The same control a group gets, pointed at the place rather
                // than at group settings. The owner gets ONLY this: offering
                // "Leave" for a chat you run is nonsense, and the database
                // will not let them join it in the first place.
                <View style={styles.roomActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="About this business"
                    onPress={() =>
                      router.push({ pathname: '/place/[id]', params: { id: placeId } })
                    }
                    hitSlop={8}>
                    <SymbolView
                      name={{ ios: 'info.circle', android: 'info', web: 'info' }}
                      size={20}
                      tintColor={theme.text}
                    />
                  </Pressable>
                  {isMember && !isOwnRoom ? (
                    <Pressable accessibilityRole="button" onPress={confirmLeave} hitSlop={8}>
                      <ThemedText type="footnote" themeColor="textSecondary">
                        Leave
                      </ThemedText>
                    </Pressable>
                  ) : null}
                </View>
              ) : /* A business never joins a room, so it can never have one
                     to leave. The owner of this one reads it above; anybody
                     else holding a business account reaching this branch
                     would be looking at a control that can only fail. */
              isMember && !viewerIsBusiness ? (
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
            {chatsQuery.isPending ? null : isOwnRoom ? (
              // The owner has no room_members row — the database refuses one
              // — so without this branch the person who runs the place was
              // told to "join in to post" in their own chat. The count comes
              // off my_chats, which already carries it for a member; room_info
              // is only fetched for people who are not in the room.
              <ThemedText type="footnote" themeColor="textSecondary">
                {countOf(membership?.member_count ?? info?.member_count ?? 0, 'person', 'people')}{' '}
                in this chat · you run it
              </ThemedText>
            ) : isMember && membership?.expires_at ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                {countOf(membership.member_count ?? 0, 'person', 'people')} in this chat
                {/* A private group is not readable by passers-by, and saying
                    it is would be worse than saying nothing. */}
                {isGroup ? '' : ' · anyone can read'}
                {/* `expires_at` is NOT NULL, so the admin of a chat with no
                    end date holds an infinite seat, and PostgREST sends that
                    as the string "infinity" — truthy, and `new Date` of it is
                    Invalid Date. */}
                {finiteDate(membership.expires_at)
                  ? ` · you leave ${finiteDate(membership.expires_at)!.toLocaleDateString(
                      undefined,
                      {
                        day: 'numeric',
                        month: 'short',
                      }
                    )}`
                  : ''}
              </ThemedText>
            ) : (
              <ThemedText type="footnote" themeColor="textSecondary">
                {info ? `${countOf(info.member_count, 'person', 'people')} in this chat. ` : ''}
                {/* "Join in to post" is an instruction a business can never
                    follow, so in somebody else's room the sentence stops at
                    what it can do. */}
                {viewerIsBusiness
                  ? 'Anyone can read this chat.'
                  : 'Anyone can read this chat. Join in to post.'}
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
            canReact={isMember && !closed}
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
            // And tapping that face opens them, which is where messaging
            // them or putting them in another group now lives.
            //
            // Not for a guest: /profile/[userId] sits behind signedIn &&
            // onboarded, so the route does not exist for them and the push
            // would be a tap that is allowed to do nothing. Passing nothing
            // leaves the face a plain view, which is honest.
            //
            // And not for a business, which fails the same guard for the same
            // structural reason. That one was worse: it was suppressed for
            // guests only, so in the room a business RUNS every avatar was
            // tappable for the owner and every tap did nothing.
            onOpenSender={
              isGuest || viewerIsBusiness
                ? undefined
                : (senderId) =>
                    router.push({
                      pathname: '/profile/[userId]',
                      params: { userId: senderId, from: 'group', chatId: id! },
                    })
            }
            noteFor={(m) => (byId.get(m.id)?.removed ? 'Message removed by the host' : null)}
            // "Ana is in" - the room recording an arrival, centred, no
            // bubble. The kind lives on the RPC row, so it is looked up the
            // same way the sender's name is.
            systemFor={(m) => (byId.get(m.id)?.kind === 'joined' ? m.body : null)}
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
            // Hosts only, and the menu simply does not carry the action for
            // anybody else — an action you can see and cannot perform is
            // worse than one that was never offered.
            // No local onError: the global mutation handler answers with the
            // shared vocabulary ('three pins is the limit' has a written
            // sentence in src/lib/failure-message.ts), so there is one place
            // to look for failure copy.
            onPin={isModerator ? (messageId) => pin.mutate({ messageId }) : undefined}
            // Remove and Report side by side, never one instead of the
            // other. The moderator's menu used to swap Report OUT for
            // Remove, which left the person best placed to spot abuse early
            // with no way to escalate a message they had to delete.
            onRemove={
              isModerator
                ? (messageId) =>
                    Alert.alert('Remove this message?', 'It disappears for everyone.', [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => removeMessage.mutate(messageId),
                      },
                    ])
                : undefined
            }
            // For every reader, moderator included — a group is where you
            // meet strangers, so it is exactly where reporting has to work.
            // A signed-out visitor gets the account gate instead of a push
            // at a route that is not mounted for them and would do nothing.
            onReport={
              isSignedOut
                ? () => {
                    // The menu's modal is still dismissing when this runs,
                    // and iOS silently drops a presentation started during a
                    // dismissal (see traps) — wait the settle window.
                    setTimeout(() => setReportGate(true), SHEET_SETTLE_MS);
                  }
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
              ) : messagesQuery.isPending ? null : isGroup &&
                !muted &&
                (membership?.member_count ?? 0) < 2 ? (
                // The screen straight after the most effortful thing in the
                // Chat tab: a named group, a photo, a posting rule — and one
                // person in it. The one thing they need next is getting
                // anybody else in, so the empty state answers THAT question.
                // "Go first" belongs to a room that has people to hear it.
                <View style={styles.emptyThread}>
                  <ThemedText type="callout" themeColor="textSecondary">
                    Your group is ready.
                  </ThemedText>
                  <PrimaryButton
                    label="Invite people"
                    onPress={() => router.push(`/group/${id}`)}
                  />
                </View>
              ) : (
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

          {/* This branch FIRST. useMyChats is disabled without a user id, so
              for a signed-out visitor the query never leaves isPending - and
              this footer, the only thing on the screen offering an account,
              never rendered at all. A visitor could read a venue room
              forever with no way in.

              `&& !isMember` is what lets a guest use the thing they were
              invited to. `isGuest` alone answers true for a named guest as
              well, so somebody who opened a link, typed a name and joined a
              group was shown "create an account to post" in the group they
              had just joined - the whole feature, refused by the client in
              the one place the database allows it. */}
          {isGuest && !isMember ? (
            <View style={styles.footer}>
              {/* Deliberately an account and not a name, and this is the
                  line between the two. A guest identity is scoped to a chat
                  somebody handed them a link to; a venue room is a public
                  front door, and a free-to-mint identity posting through it
                  is a different risk. Reading stays open to everyone, which
                  is what the room is for. */}
              <SignUpGate reason="Join this room to post" where="room" compact />
            </View>
          ) : chatsQuery.isPending ? null : closed ? (
            // Ahead of `muted`, deliberately. In a restricted group both are
            // true at once and the muted line would have kept saying "you can
            // read and react" about a chat where reacting now fails too.
            <View style={styles.footer}>
              <ThemedView type="backgroundElement" style={styles.mutedNotice}>
                <ThemedText type="small" themeColor="textSecondary">
                  {closeDayLabel(group?.max_stay_until ?? null)
                    ? `This group closed on ${closeDayLabel(group?.max_stay_until ?? null)}. Everything in it is still here to read.`
                    : 'This group has closed. Everything in it is still here to read.'}
                </ThemedText>
              </ThemedView>
            </View>
          ) : muted ? (
            <View style={styles.footer}>
              <ThemedView type="backgroundElement" style={styles.mutedNotice}>
                <ThemedText type="small" themeColor="textSecondary">
                  Only the admin and who they pick can post. You can read and react.
                </ThemedText>
              </ThemedView>
            </View>
          ) : isMember ? (
            <View style={styles.composerWrap}>
              <Composer
                inputTestID="room-composer"
                // One word per thing: a traveler-made one is a group, a
                // business-run one is a room, and the composer is the last
                // word the person reads before speaking into it.
                placeholder={isGroup ? 'Message the group…' : 'Message the room…'}
                // Not for a guest: messages_guest_limits refuses an
                // image_path outright, so the button could only ever fail.
                // Photos cost storage and a vision call apiece and a free
                // identity is the wrong thing to spend them on.
                allowPhotos={!isGuestAccount}
                photoBusy={sendPhoto.isPending}
                onSend={async ({ text, photoUri }) => {
                  // One message, photo and caption together — see chat/[id].
                  // A photo failure throws so the composer keeps the picture
                  // staged; text has a failed bubble of its own to live in.
                  if (photoUri) {
                    try {
                      await sendPhoto.mutateAsync({ localUri: photoUri, body: text });
                    } catch (error) {
                      Alert.alert('Could not send', 'Check your connection and try again.');
                      throw error;
                    }
                    return;
                  }
                  if (text.length > 0) {
                    send.mutate(text);
                  }
                }}
              />
            </View>
          ) : viewerIsBusiness ? (
            <View style={styles.footer}>
              {/* Not a join prompt with the button taken out: a business is
                  not a guest of a room, so there is nothing here to say no
                  to. Reading stays open, which is what a room is for. And it
                  says where the owner's own room is, because "yours is on
                  your business page" stopped being the whole truth the day
                  the Chat tab started listing it. */}
              <ThemedText type="footnote" themeColor="textSecondary">
                Rooms are for travelers. You can read this one. Yours is at the top of your Chat
                tab.
              </ThemedText>
            </View>
          ) : (
            <View style={styles.footer}>
              <ThemedText type="footnote" themeColor="textSecondary">
                When do you check out? You drop out of the chat three days later.
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
                {/* Title case, matching the app-wide retirement of all-caps
                    labels (DESIGN.md). */}
                <ThemedText type="caption" themeColor="textSecondary">
                  Checking out
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
                  themeVariant={NativeAppearance}
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
        {/* Outside the scroller: iOS hosts it in the keyboard's own window,
            so where it sits only decides which fields can reach it. */}
        <KeyboardDoneBar />
        {/* The account gate for a signed-out visitor who tried to report.
            /report is behind the signed-in guard, so the alternative was a
            tap allowed to do nothing on the one control that must never be
            dead. Navigation out of a presented sheet goes through
            leavingSheet, or its scrim outlives the push (see traps). */}
        {reportGate ? (
          <Sheet onClose={() => setReportGate(false)}>
            <SignUpGate
              reason="Send your report"
              where="room-report"
              onNavigate={leavingSheet(() => setReportGate(false))}
            />
          </Sheet>
        ) : null}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  roomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
  },
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
