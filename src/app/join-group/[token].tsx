import DateTimePicker from '@react-native-community/datetimepicker';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { StepScreen } from '@/components/form/step-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { useGroupInvitePreview, useJoinGroup } from '@/features/groups/hooks';
import { useIsGuest } from '@/features/guest/hooks';
import { formatDate, parseISODate, toISODate } from '@/features/trips/dates';
import { useTheme } from '@/hooks/use-theme';
import { countOf, isAre } from '@/lib/plural';

/**
 * The far end of an invite link.
 *
 * It shows what the group is before asking anything, then asks the one
 * question joining actually needs: how long you want to be in it. The date
 * is capped at whatever the admin set, here for kindness and again in the
 * database for correctness.
 */
export default function JoinGroupScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const theme = useTheme();
  const isGuest = useIsGuest();
  const preview = useGroupInvitePreview(token ?? null);
  const join = useJoinGroup();
  const group = preview.data ?? null;
  const { data: photoUrl } = useChatPhotoUrl(group?.photo_path ?? null);

  const maxDate = group ? parseISODate(group.max_stay_until) : null;
  const [stayUntil, setStayUntil] = useState<Date | null>(null);
  const [pickingDate, setPickingDate] = useState(false);

  // Default to the group's own horizon, which is what most people want and
  // the only value guaranteed to be valid.
  const chosen = stayUntil ?? maxDate;

  if (preview.isPending) {
    return <ThemedView style={styles.root} />;
  }

  if (preview.isError) {
    // Distinct from "not open". This query does not even retry, so one flaky
    // moment used to tell somebody their friend's link was dead and send them
    // back to ask for another one.
    return (
      <ThemedView style={styles.root}>
        <LoadError what="this invite" error={preview.error} onRetry={() => preview.refetch()} />
      </ThemedView>
    );
  }

  if (!group) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.centered}>
          <ThemedText type="headline">This invite is not open</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            It may have expired or been turned off. Ask whoever sent it for a new link.
          </ThemedText>
          <PrimaryButton variant="ghost" label="Go back" onPress={() => router.back()} />
        </View>
      </ThemedView>
    );
  }

  if (isGuest) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.centered}>
          <ThemedText type="headline">{group.name}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            {countOf(group.member_count, 'person', 'people')} {isAre(group.member_count)} in this
            group. You need a profile to join in.
          </ThemedText>
          <SignUpGate reason="Join the group" cta="Make a profile" />
        </View>
      </ThemedView>
    );
  }

  if (group.already_member) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.centered}>
          <ThemedText type="headline">You are already in {group.name}</ThemedText>
          <PrimaryButton
            label="Open the group"
            onPress={() => router.replace(`/room/${group.chat_id}`)}
          />
        </View>
      </ThemedView>
    );
  }

  const submit = async () => {
    if (!chosen) {
      return;
    }
    try {
      const result = await join.mutateAsync({
        token: token!,
        stayUntil: toISODate(chosen),
      });
      router.replace(`/room/${result.chat_id}`);
    } catch {
      // Surfaced by the global mutation error alert.
    }
  };

  return (
    <StepScreen
      title={group.name}
      subtitle={`${countOf(group.member_count, 'person', 'people')} in the group`}
      continueLabel="Join the group"
      continueDisabled={chosen == null}
      continueLoading={join.isPending}
      onContinue={submit}>
      <View style={styles.identity}>
        <View style={[styles.groupPhoto, { backgroundColor: theme.surfaceSunken }]}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.fill} contentFit="cover" />
          ) : (
            <SymbolView
              name={{ ios: 'person.3.fill', android: 'groups', web: 'groups' }}
              size={26}
              tintColor={theme.textSecondary}
            />
          )}
        </View>
        {group.speaking === 'granted' ? (
          <ThemedText type="footnote" themeColor="textSecondary" style={styles.identityNote}>
            Posting in this group is limited to the admin and the people they pick. You can read
            everything.
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.block}>
        <ThemedText type="smallBold">Stay in the group until</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          You drop out on your own afterwards. The admin has set {formatDate(group.max_stay_until)}{' '}
          as the latest anyone can pick.
        </ThemedText>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={chosen ?? new Date()}
            mode="date"
            display="compact"
            minimumDate={new Date()}
            maximumDate={maxDate ?? undefined}
            themeVariant="dark"
            onChange={(_, date) => {
              if (date) {
                setStayUntil(date);
              }
            }}
          />
        ) : (
          <>
            <PrimaryButton
              variant="ghost"
              label={chosen ? formatDate(toISODate(chosen)) : 'Pick a date'}
              onPress={() => setPickingDate(true)}
            />
            {pickingDate ? (
              <DateTimePicker
                value={chosen ?? new Date()}
                mode="date"
                minimumDate={new Date()}
                maximumDate={maxDate ?? undefined}
                onChange={(_, date) => {
                  setPickingDate(false);
                  if (date) {
                    setStayUntil(date);
                  }
                }}
              />
            ) : null}
          </>
        )}
      </View>
    </StepScreen>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    gap: Space.md,
    padding: Space.lg,
  },
  centerText: {
    textAlign: 'center',
  },
  identity: {
    gap: Space.md,
  },
  identityNote: {
    maxWidth: 420,
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
  block: {
    gap: Space.sm,
  },
  fill: {
    width: '100%',
    height: '100%',
  },
});
