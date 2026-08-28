import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Platform, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormTextField } from '@/components/form/form-text-field';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Segmented } from '@/components/ui/segmented';
import { HitTarget, MaxContentWidth, NativeAppearance, Radius, Space } from '@/constants/theme';
import { uploadGroupPhoto } from '@/features/groups/api';
import {
  useGroup,
  useGroupInviteToken,
  useGroupMembers,
  useRemoveGroupMember,
  useRevokeGroupInvites,
  useSetGroupRole,
  useUpdateGroup,
} from '@/features/groups/hooks';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { InviteQr } from '@/features/groups/invite-qr';
import { useOwnUserId, usePhotoUrl } from '@/features/profile/hooks';
import { closeDayLabel, useHasGroupClosed } from '@/features/groups/closing';
import { addDays, formatDate, parseISODate, toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { pickImage } from '@/lib/pick-image';
import type { GroupMemberRow, GroupSpeaking } from '@/lib/database.types';

/** One link, whether it is being scanned, shared or pasted. */
function inviteUrl(token: string): string {
  return Linking.createURL(`/join-group/${token}`);
}

const SPEAKING_OPTIONS: { value: GroupSpeaking; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'granted', label: 'Only who I pick' },
];

function MemberRow({
  member,
  chatId,
  isAdmin,
  restricted,
}: {
  member: GroupMemberRow;
  chatId: string;
  isAdmin: boolean;
  restricted: boolean;
}) {
  const theme = useTheme();
  const { data: photoUrl } = usePhotoUrl(member.photo_path);
  const setRole = useSetGroupRole(chatId);
  const remove = useRemoveGroupMember(chatId);
  const name = member.display_name ?? 'Traveler';

  const openActions = () => {
    const canSpeak = member.role !== 'member';
    const options = [
      restricted ? (canSpeak ? 'Take back the microphone' : 'Let them post') : null,
      `Remove ${name}`,
      'Cancel',
    ].filter((o) => o != null);
    const run = (label: string) => {
      if (label === 'Let them post') {
        setRole.mutate({ userId: member.user_id, role: 'speaker' });
      } else if (label === 'Take back the microphone') {
        setRole.mutate({ userId: member.user_id, role: 'member' });
      } else if (label.startsWith('Remove')) {
        Alert.alert(`Remove ${name}?`, 'They lose access to the group and its messages.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => remove.mutate(member.user_id),
          },
        ]);
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: options.length - 2,
          cancelButtonIndex: options.length - 1,
          title: name,
        },
        (index) => run(options[index])
      );
    } else {
      Alert.alert(name, undefined, [
        ...options.filter((o) => o !== 'Cancel').map((o) => ({ text: o, onPress: () => run(o) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const roleLabel =
    member.role === 'admin' ? 'Admin' : restricted && member.role === 'speaker' ? 'Can post' : null;

  return (
    <PressableScale
      accessibilityRole={isAdmin && member.role !== 'admin' ? 'button' : 'text'}
      accessibilityLabel={name}
      haptic={isAdmin && member.role !== 'admin' ? 'light' : 'none'}
      scaleTo={isAdmin && member.role !== 'admin' ? 0.98 : 1}
      disabled={!isAdmin || member.role === 'admin'}
      onPress={openActions}
      style={styles.memberRow}>
      <View style={[styles.avatar, { backgroundColor: theme.surfaceSunken }]}>
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
      <View style={styles.memberText}>
        <ThemedText type="callout">{name}</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          {/* Null for the admin of a chat with no end date: they never leave,
              and formatDate would have thrown on the split. */}
          {member.departure_date ? `Here until ${formatDate(member.departure_date)}` : 'Here'}
        </ThemedText>
      </View>
      {roleLabel ? (
        <View style={[styles.roleChip, { backgroundColor: theme.accentSoft }]}>
          <ThemedText type="caption" themeColor="accent">
            {roleLabel}
          </ThemedText>
        </View>
      ) : null}
      {isAdmin && member.role !== 'admin' ? (
        <SymbolView
          name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
          size={16}
          tintColor={theme.textSecondary}
        />
      ) : null}
    </PressableScale>
  );
}

/**
 * A group's own page: what it is called, who may post, who is in it, and the
 * link that lets somebody else in.
 *
 * Everyone in the group can see this. Only the admin's taps do anything —
 * and that is enforced in the database, not by hiding buttons, so a member
 * who found their way here cannot rename the group by other means.
 */

/**
 * A day the date control is always allowed to display.
 *
 * A closed group's stored date is in the past while the picker's minimum is
 * today, so handing the stored value straight to the control makes iOS show
 * the clamped minimum instead — and then confirming the day it is showing
 * fires no onChange and does nothing, which makes the one control that
 * reopens a chat look broken.
 */
function pickerDay(maxStayUntil: string | null): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const stored = maxStayUntil ? parseISODate(maxStayUntil) : null;
  return stored != null && stored.getTime() >= today.getTime() ? stored : addDays(new Date(), 30);
}

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const ownUserId = useOwnUserId();
  const groupQuery = useGroup(id ?? null);
  const group = groupQuery.data;
  const { data: members = [] } = useGroupMembers(id ?? null);
  const update = useUpdateGroup(id!);
  const revokeInvites = useRevokeGroupInvites(id!);
  const { data: photoUrl } = useChatPhotoUrl(group?.photo_path ?? null);

  const myRole = members.find((m) => m.user_id === ownUserId)?.role ?? null;
  const isAdmin = myRole === 'admin';
  const restricted = group?.speaking === 'granted';

  const { data: inviteToken } = useGroupInviteToken(id ?? null, isAdmin);

  const [name, setName] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [editingDate, setEditingDate] = useState(false);
  const closed = useHasGroupClosed(group?.max_stay_until ?? null);
  // Always a day the control is allowed to display: today's minimum rules out
  // a stored date in the past, and a chat with no end date has none at all.
  const pickerValue = pickerDay(group?.max_stay_until ?? null);

  if (!group) {
    // A failed fetch is not an empty group. This used to render a blank
    // screen either way, so somebody on hostel wifi got a dark rectangle
    // with no message and no way forward — the same trap the chat list and
    // the map both had, and the same LoadError fixes it.
    return (
      <ThemedView style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          {groupQuery.isError ? (
            <LoadError
              what="this group"
              error={groupQuery.error}
              onRetry={() => groupQuery.refetch()}
            />
          ) : groupQuery.isSuccess ? (
            <ThemedText themeColor="textSecondary">This group is no longer around.</ThemedText>
          ) : null}
        </ScrollView>
      </ThemedView>
    );
  }

  const shownName = name ?? group.name;

  // Refusing a name used to be the same statement as throwing it away:
  // setName(null) ran before the length guard, so renaming a group to one
  // letter reverted the field to the old name and said nothing. The one
  // action that put the keyboard away was also the one that ate the input.
  const saveName = () => {
    const next = shownName.trim();
    if (next.length < 2) {
      setNameError('Give it at least two characters.');
      return;
    }
    setNameError(null);
    setName(null);
    if (next !== group.name) {
      update.mutate({ name: next });
    }
  };

  const share = async () => {
    if (!inviteToken) {
      return;
    }
    const url = inviteUrl(inviteToken);
    try {
      await Share.share({
        // One string, so it lands intact in a text message, an email or the
        // clipboard. The share sheet is already the "text, email or copy"
        // chooser the founder asked for; there is no need to build another.
        message: `Join "${group.name}" on Samewhere: ${url}\n\nIf that link does not open, put this code into the app: ${inviteToken}`,
      });
    } catch {
      // Dismissing the share sheet is not an error.
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="always">
          <View style={styles.identity}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={isAdmin ? 'Change group photo' : 'Group photo'}
              haptic={isAdmin ? 'light' : 'none'}
              scaleTo={isAdmin ? 0.94 : 1}
              disabled={!isAdmin || !ownUserId}
              onPress={async () => {
                const uri = await pickImage();
                if (!uri || !ownUserId) {
                  return;
                }
                try {
                  const path = await uploadGroupPhoto(ownUserId, uri);
                  update.mutate({ photoPath: path });
                } catch {
                  Alert.alert('Could not upload', 'Check your connection and try again.');
                }
              }}
              style={[styles.groupPhoto, { backgroundColor: theme.surfaceSunken }]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
              ) : (
                <SymbolView
                  name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
                  size={26}
                  tintColor={theme.textSecondary}
                />
              )}
            </PressableScale>
            {isAdmin ? (
              <FormTextField
                label="Name"
                value={shownName}
                onChangeText={(next) => {
                  setName(next);
                  if (nameError) {
                    setNameError(null);
                  }
                }}
                onBlur={saveName}
                onSubmitEditing={saveName}
                returnKeyType="done"
                maxLength={60}
                error={nameError}
              />
            ) : (
              <ThemedText type="title">{group.name}</ThemedText>
            )}
          </View>

          <View style={styles.section}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
              Who can post
            </ThemedText>
            {isAdmin ? (
              <Segmented
                options={SPEAKING_OPTIONS}
                value={group.speaking}
                onChange={(speaking) => update.mutate({ speaking })}
                accessibilityLabel="Who can post in this group"
              />
            ) : null}
            <ThemedText type="footnote" themeColor="textSecondary">
              {restricted
                ? 'The admin posts, plus anyone they give the microphone to. Everyone else can read.'
                : 'Anyone in the group can post.'}
            </ThemedText>
          </View>

          <View style={styles.section}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
              Chat is active until
            </ThemedText>
            {closed ? (
              <ThemedText type="smallBold" style={{ color: theme.warning }}>
                {closeDayLabel(group.max_stay_until)
                  ? `This chat closed on ${closeDayLabel(group.max_stay_until)}`
                  : 'This chat has closed'}
              </ThemedText>
            ) : null}
            {isAdmin ? (
              <>
                {/* Which of the two controls below is the ANSWER, and which is
                    the offer. With no end date set, the picker still has to
                    show a day - it is a date picker - and printing one
                    straight under "Chat is active until", above a ticked "No
                    end date", is the screen contradicting itself. This line
                    says which one you are reading. */}
                {group.max_stay_until ? null : (
                  <ThemedText type="footnote" themeColor="textSecondary">
                    Pick a day to close it on:
                  </ThemedText>
                )}
                {/* The picker always opens on a day it is allowed to show. A
                    closed group's stored date is in the past and the minimum
                    is today, so handing the stored value straight to the
                    control made it display the clamped minimum instead — and
                    confirming the day it showed then did nothing, which makes
                    the one control that reopens a chat look broken. */}
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={pickerValue}
                    mode="date"
                    display="compact"
                    minimumDate={new Date()}
                    themeVariant={NativeAppearance}
                    onChange={(_, date) => {
                      if (date) {
                        update.mutate({ maxStayUntil: toISODate(date) });
                      }
                    }}
                  />
                ) : (
                  <>
                    <PrimaryButton
                      variant="ghost"
                      label={
                        group.max_stay_until ? formatDate(group.max_stay_until) : 'No end date'
                      }
                      onPress={() => setEditingDate(true)}
                    />
                    {editingDate ? (
                      <DateTimePicker
                        value={pickerValue}
                        mode="date"
                        minimumDate={new Date()}
                        onChange={(_, date) => {
                          setEditingDate(false);
                          if (date) {
                            update.mutate({ maxStayUntil: toISODate(date) });
                          }
                        }}
                      />
                    ) : null}
                  </>
                )}
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={
                    group.max_stay_until ? 'Give this chat no end date' : 'No end date'
                  }
                  accessibilityState={{ selected: group.max_stay_until == null }}
                  haptic="selection"
                  scaleTo={0.98}
                  // A radio, not a toggle. It is drawn with a filled
                  // checkmark and an accent border when there is no end date,
                  // so tapping it there reads as confirming the state you are
                  // already in — and it used to quietly hand the chat a
                  // thirty-day expiry instead. Setting a date is the picker's
                  // job, right above this.
                  onPress={() => {
                    if (group.max_stay_until) {
                      update.mutate({ clearMaxStay: true });
                    }
                  }}>
                  <ThemedView
                    type={group.max_stay_until == null ? 'accentSoft' : 'backgroundElement'}
                    style={[
                      styles.noEndRow,
                      {
                        borderColor: group.max_stay_until == null ? theme.accent : 'transparent',
                      },
                    ]}>
                    <SymbolView
                      name={
                        group.max_stay_until == null
                          ? {
                              ios: 'checkmark.circle.fill',
                              android: 'check_circle',
                              web: 'check_circle',
                            }
                          : {
                              ios: 'circle',
                              android: 'radio_button_unchecked',
                              web: 'radio_button_unchecked',
                            }
                      }
                      size={20}
                      tintColor={group.max_stay_until == null ? theme.accent : theme.textSecondary}
                    />
                    <ThemedText>No end date</ThemedText>
                  </ThemedView>
                </PressableScale>
              </>
            ) : (
              <ThemedText>
                {group.max_stay_until ? formatDate(group.max_stay_until) : 'No end date'}
              </ThemedText>
            )}
            <ThemedText type="footnote" themeColor="textSecondary">
              {group.max_stay_until
                ? 'The chat is active through that day and closes the day after. Nobody can pick a later date to stay until.'
                : 'This chat stays open until somebody sets an end date.'}
            </ThemedText>
          </View>

          {isAdmin ? (
            <View style={styles.section}>
              <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
                Invite
              </ThemedText>
              {/* A square somebody can point a phone at. The hostel lobby is
                  literally this use case: you are standing in front of four
                  people, and "let me get your number so I can send you a
                  link" is three steps where holding up a screen is none. */}
              {inviteToken ? <InviteQr url={inviteUrl(inviteToken)} /> : null}
              <PrimaryButton label="Share an invite" disabled={!inviteToken} onPress={share} />
              <PrimaryButton
                variant="ghost"
                label="Turn off the current link"
                onPress={() =>
                  Alert.alert(
                    'Turn off the link?',
                    'Anyone still holding it will not be able to join. A new link is made the next time you share.',
                    [
                      { text: 'Keep it', style: 'cancel' },
                      {
                        text: 'Turn it off',
                        style: 'destructive',
                        onPress: () => revokeInvites.mutate(),
                      },
                    ]
                  )
                }
              />
            </View>
          ) : null}

          <View style={styles.section}>
            <ThemedText type="caption" themeColor="textSecondary" style={styles.sectionLabel}>
              {members.length} {members.length === 1 ? 'person' : 'people'}
            </ThemedText>
            {members.map((member) => (
              <MemberRow
                key={member.user_id}
                member={member}
                chatId={id!}
                isAdmin={isAdmin}
                restricted={restricted ?? false}
              />
            ))}
            {isAdmin ? (
              <ThemedText type="footnote" themeColor="textSecondary">
                Tap someone to give them the microphone or take them out of the group.
              </ThemedText>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  noEndRow: {
    minHeight: HitTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.md,
    borderRadius: Radius.lg,
    // Always drawn, only ever changing colour, so choosing it cannot shove
    // the fine print underneath it.
    borderWidth: 1,
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
  content: {
    gap: Space.xl,
    padding: Space.lg,
  },
  identity: {
    gap: Space.md,
  },
  groupPhoto: {
    width: 84,
    height: 84,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    gap: Space.sm,
  },
  sectionLabel: {
    // Sentence case, so the all-caps letter-spacing that used to hold
    // these apart is no longer doing a job (docs/DESIGN.md).
    letterSpacing: 0.2,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberText: {
    flex: 1,
    gap: 2,
  },
  roleChip: {
    paddingHorizontal: Space.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
