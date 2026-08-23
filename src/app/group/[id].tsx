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
import { MaxContentWidth, NativeAppearance, Radius, Space } from '@/constants/theme';
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
import { formatDate, parseISODate, toISODate } from '@/features/trips/dates';
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
          Here until {formatDate(member.departure_date)}
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
  const [editingDate, setEditingDate] = useState(false);

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

  const saveName = () => {
    const next = shownName.trim();
    setName(null);
    if (next.length >= 2 && next !== group.name) {
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
                onChangeText={setName}
                onBlur={saveName}
                onSubmitEditing={saveName}
                returnKeyType="done"
                maxLength={60}
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
              People can stay until
            </ThemedText>
            {isAdmin ? (
              Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={parseISODate(group.max_stay_until)}
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
                    label={formatDate(group.max_stay_until)}
                    onPress={() => setEditingDate(true)}
                  />
                  {editingDate ? (
                    <DateTimePicker
                      value={parseISODate(group.max_stay_until)}
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
              )
            ) : (
              <ThemedText>{formatDate(group.max_stay_until)}</ThemedText>
            )}
            <ThemedText type="footnote" themeColor="textSecondary">
              Nobody can pick a date past this one, and membership ends on its own afterwards.
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
