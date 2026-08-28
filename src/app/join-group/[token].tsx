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
import { NativeAppearance, Radius, Space } from '@/constants/theme';
import { useChatPhotoUrl } from '@/features/chat/hooks';
import { closeDayLabel } from '@/features/groups/closing';
import { useAuthStore } from '@/features/auth/store';
import { useGroupInvitePreview, useJoinGroup } from '@/features/groups/hooks';
import { useIsSignedOut } from '@/features/guest/hooks';
import { addDays, formatDate, parseISODate, toISODate } from '@/features/trips/dates';
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
  const isSignedOut = useIsSignedOut();
  // One reading of "now" for the whole screen, taken at mount. Every date
  // comparison below has to agree with every other one, and a clock re-read
  // on each render does not — the floor of the picker would drift under a
  // ceiling computed a frame earlier.
  const [openedAt] = useState(() => new Date());
  const preview = useGroupInvitePreview(token ?? null);
  const join = useJoinGroup();
  const inviteRemembered = useAuthStore((s) => s.inviteRemembered);
  const group = preview.data ?? null;
  const { data: photoUrl } = useChatPhotoUrl(group?.photo_path ?? null);

  // Null when the group has no end date, which is now the common case: there
  // is no ceiling on how long you can say you are staying.
  const rawMaxDate = group?.max_stay_until ? parseISODate(group.max_stay_until) : null;
  // Never behind the minimum. A chat whose last day is TODAY (or, for a few
  // hours around a timezone boundary, yesterday) handed the picker a maximum
  // earlier than its minimum, and iOS renders that as a control that cannot
  // be moved to any value at all.
  const maxDate = rawMaxDate && rawMaxDate.getTime() < openedAt.getTime() ? null : rawMaxDate;

  // The way out, and it has to work on a phone that has never opened this app
  // before. An invite is very often somebody's FIRST launch: the link is the
  // only route in the stack, `router.back()` dispatches a GO_BACK nothing
  // handles, and the tap silently does nothing. Falling through to the tabs
  // means declining an invite always lands on the map rather than nowhere.
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  // Off to make an account, holding the invite. Without this the token dies
  // with this screen and they finish onboarding on the map, no closer to the
  // chat they tapped a link to join.
  const leaveForAccount = (go: () => void) => {
    if (token) {
      inviteRemembered(token);
    }
    go();
  };
  const [stayUntil, setStayUntil] = useState<Date | null>(null);
  const [pickingDate, setPickingDate] = useState(false);
  // A group with no end date leaves nothing to default to, and a null default
  // greyed out "Join the group" under a picker already showing today — with
  // nothing on screen to say why, and no way out but to nudge the date. A
  // month ahead is the same horizon a new group offers. Read once at mount so
  // a re-render cannot move it.
  const [aMonthOut] = useState(() => addDays(new Date(), 30));

  // Default to the group's own horizon where it has one: it is what most
  // people want and the only value guaranteed to be valid.
  const chosen = stayUntil ?? maxDate ?? aMonthOut;

  // `&& token`: with no token the query never runs, so isPending stays true
  // forever and this branch painted a blank screen with nothing on it. A
  // truncated or mistyped link now falls through to "not open", which at
  // least says something and offers a way out.
  if (preview.isPending && token) {
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
          <PrimaryButton variant="ghost" label="Go back" onPress={leave} />
        </View>
      </ThemedView>
    );
  }

  // A chat that reached its own last day is a different story from a link
  // somebody withdrew, and the preview returns the row either way now so this
  // screen can tell them apart. Saying "the link may have been turned off"
  // about a group that simply ran its course sends somebody back to a friend
  // to ask for a new link that would not help.
  if (group.closed) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.centered}>
          <ThemedText type="headline">{`${group.name} has ended`}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            This chat closed
            {closeDayLabel(group.max_stay_until)
              ? ` on ${closeDayLabel(group.max_stay_until)}`
              : ''}
            , so there is nothing to join. Whoever runs it can start a new one.
          </ThemedText>
          <PrimaryButton variant="ghost" label="Go back" onPress={leave} />
        </View>
      </ThemedView>
    );
  }

  // Reachable as of 20260823050000. Before that grant, the preview threw
  // 42501 for a signed-out caller and the error branch above caught it, so
  // an invited friend was told the link was broken instead of being shown
  // what they had been invited to.
  //
  // A name is the whole ask now. The account is offered second because it is
  // the bigger one, and taking it later costs nothing: the same auth row
  // gains an email, so this chat comes with them.
  if (isSignedOut) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.centered}>
          <ThemedText type="headline">You are invited to {group.name}</ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.centerText}>
            {countOf(group.member_count, 'person', 'people')} {isAre(group.member_count)} in it.
            Type a name and you are in.
          </ThemedText>
          <PrimaryButton
            label="Join with a name"
            onPress={() =>
              router.push({
                pathname: '/guest-name',
                params: { next: `/join-group/${token}` },
              })
            }
          />
          {/* Not "Or make a profile". The founder read this section as hard
              to read, and the colours are not why — every string on this
              screen measures 7.9:1 or better against the ground. What made it
              hard is that it read as a fragment ("Or ...") and then repeated
              itself one line later on its own button, directly under a filled
              button offering the other answer. A question, and one answer to
              it. */}
          <SignUpGate
            reason="Rather have a full profile?"
            where="group-invite"
            cta="Make a profile"
            onNavigate={leaveForAccount}
          />
          {/* Nobody has to answer this to use the app. The link is somebody
              else's invitation, and the map is open to everyone. */}
          <PrimaryButton variant="ghost" label="Just look around" onPress={leave} />
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
          <PrimaryButton variant="ghost" label="Not now" onPress={leave} />
        </View>
      </ThemedView>
    );
  }

  const submit = async () => {
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
      continueLoading={join.isPending}
      onClose={leave}
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
          {group.max_stay_until
            ? `You drop out on your own afterwards. This chat is active until ${formatDate(group.max_stay_until)}, so that is the latest anyone can pick.`
            : 'You drop out on your own afterwards. This chat has no end date, so pick whatever suits your trip.'}
        </ThemedText>
        {Platform.OS === 'ios' ? (
          <DateTimePicker
            value={chosen}
            mode="date"
            display="compact"
            minimumDate={new Date()}
            maximumDate={maxDate ?? undefined}
            themeVariant={NativeAppearance}
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
              label={formatDate(toISODate(chosen))}
              onPress={() => setPickingDate(true)}
            />
            {pickingDate ? (
              <DateTimePicker
                value={chosen}
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
