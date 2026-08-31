import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DockedActionBar, dockedActionBarHeight } from '@/components/ui/docked-action-bar';
import { LoadError } from '@/components/ui/load-error';
import { Skeleton } from '@/components/ui/skeleton';
import { MaxContentWidth, Radius, Space } from '@/constants/theme';
import { useBlockUser } from '@/features/chat/hooks';
import { useSharesGroupWith } from '@/features/groups/hooks';
import {
  useFirstMessageBudget,
  useMyChats,
  useSentRequests,
  useUnlockedSocialHandles,
} from '@/features/matching/hooks';
import { openReply } from '@/features/matching/respond';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import {
  useProfilePriorities,
  useProfilePrompts,
  usePublicPhotos,
  usePublicProfile,
} from '@/features/profile/hooks';
import { useTravelerTrips } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';

/**
 * Another traveler's profile: the same page they see of themselves, minus
 * the edit affordances. Socials appear here once a chat is open — the
 * database decides that, and this screen simply renders whatever comes back
 * (it used to draw a permanent "hidden" card and never ask, which is why
 * handles never showed up after connecting).
 */
export default function PublicProfileScreen() {
  const { userId, from } = useLocalSearchParams<{ userId: string; from?: string }>();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const profileQuery = usePublicProfile(userId ?? null);
  const photosQuery = usePublicPhotos(userId ?? null);
  const { data: prompts = [] } = useProfilePrompts(userId);
  const { data: priorities = [] } = useProfilePriorities(userId);
  const photos = photosQuery.data ?? [];
  const tripsQuery = useTravelerTrips(userId ?? null);
  const trips = tripsQuery.data ?? [];
  const handlesQuery = useUnlockedSocialHandles(userId ?? null);
  const { data: chats = [] } = useMyChats();
  const block = useBlockUser();
  const profile = profileQuery.data;

  const directChat = chats.find((chat) => chat.other_user_id === userId && chat.kind === 'direct');
  const connected = directChat != null;
  // Founder: once you are both in the same chat, messaging should be one tap
  // and not a hello somebody has to accept. The server decides what "same
  // chat" means — a traveler group, never a venue's open room — so this is
  // one question asked of it rather than a rule reimplemented here.
  const { data: sharesGroup = false } = useSharesGroupWith(userId ?? null);
  const known = connected || sharesGroup;

  // Whether a hello is already on its way. 'sent' also covers
  // pending_moderation and a silent decline — the RPC collapses those on
  // purpose (invariant 4: a sender is never told they were declined) — so a
  // second hello is never offered where the server would refuse it with a
  // unique-constraint error that destroys the message.
  const { data: sentRequests = [] } = useSentRequests();
  const alreadySaidHi = sentRequests.some((r) => r.recipient_id === userId && r.state === 'sent');
  // The same cap the Travelers bar renders: identical chrome must not offer a
  // live "Say hi" the composer would immediately full-stop.
  const budget = useFirstMessageBudget();
  const helloCapped = budget.data != null && budget.data.used >= budget.data.allowed;

  if (profileQuery.isSuccess && !profile) {
    return (
      <ThemedView style={styles.root}>
        <ThemedText themeColor="textSecondary" style={styles.centerNote}>
          This traveler isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }
  // Never a bare black screen. On hostel wifi this route used to render an
  // empty ThemedView while the query was in flight and that same empty view
  // forever if it failed, with no way to tell a deleted person from a dead
  // request.
  if (profileQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        <LoadError
          what="this profile"
          error={profileQuery.error}
          onRetry={() => profileQuery.refetch()}
        />
      </ThemedView>
    );
  }
  if (!profile) {
    return (
      <ThemedView style={styles.root}>
        <View style={styles.skeleton}>
          {/* The hero is a ratio of the width, never a fixed height — a
              hardcoded hero height is right on one phone and kicks
              everything below it down on every other. 1/1.15 is the shape
              the real hero draws (heroWidth * 1.15 in profile-view). */}
          <Skeleton aspectRatio={1 / 1.15} radius={0} />
          <View style={styles.skeletonText}>
            <Skeleton width="55%" height={20} radius={Radius.sm} />
            <Skeleton width="80%" height={14} radius={Radius.sm} />
            <Skeleton width="70%" height={14} radius={Radius.sm} />
          </View>
        </View>
      </ThemedView>
    );
  }

  const profileTrips: ProfileTrip[] = trips.map((trip) => ({
    id: trip.trip_id,
    cityId: trip.city_id,
    cityLabel: `${trip.city_name}, ${trip.city_country}`,
    startDate: trip.start_date,
    endDate: trip.end_date,
  }));

  const name = profile.display_name ?? 'Traveler';

  // Report and Block, in the nav bar's overflow rather than as the page's
  // only full-width buttons. Same pattern as the chat header's menu. App
  // Review wants in-app reporting reachable, and it still is in two taps —
  // the overflow lives in the nav bar, which is always on screen.
  const openMenu = () => {
    const items: { label: string; destructive?: boolean; run: () => void }[] = [
      {
        label: 'Report',
        run: () => router.push({ pathname: '/report', params: { userId, context: 'profile' } }),
      },
      {
        label: 'Block',
        destructive: true,
        run: () =>
          Alert.alert(
            `Block ${name}?`,
            "They're gone from the map and Travelers, and can't message you. They're not told.",
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Block',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await block.mutateAsync(userId!);
                    router.back();
                  } catch {
                    // Surfaced by the global mutation error alert.
                  }
                },
              },
            ]
          ),
      },
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

  return (
    <ThemedView style={styles.root}>
      {/* The name goes in the bar HERE, not in _layout: it only exists once
          the profile query resolves. */}
      <Stack.Screen
        options={{
          headerTitle: name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Profile options"
              onPress={openMenu}
              hitSlop={10}>
              <SymbolView
                name={{ ios: 'ellipsis.circle', android: 'more_horiz', web: 'more_horiz' }}
                size={22}
                tintColor={theme.text}
              />
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          // Nothing may come to rest under the floating bar.
          known || from === 'group'
            ? null
            : { paddingBottom: dockedActionBarHeight(insets.bottom) + Space.xl },
        ]}>
        <ProfileView
          photosPending={photosQuery.data === undefined}
          tripsPending={tripsQuery.data === undefined}
          profile={profile}
          photos={photos}
          prompts={prompts}
          priorities={priorities}
          trips={profileTrips}
          // An error must never look like "they added none": show nothing
          // rather than a wrong absence, and let the retry below speak.
          handles={handlesQuery.data ?? []}
          owner={false}
          connected={connected}
          // Only while there is still a conversation to start. Once you are
          // connected, the reply bubbles would just be a slower way to open
          // a chat you already have.
          onRespondTo={
            // No reply bubbles once a hello is on its way either: every one
            // of them would route into the same unique-constraint refusal.
            known || alreadySaidHi || !userId
              ? undefined
              : (target) =>
                  openReply({
                    userId,
                    name,
                    photoPath: photos[0]?.storage_path ?? null,
                    target,
                    // What the database will be asked to verify. Reached from
                    // a pin, that is the pin; from anywhere else, a shared
                    // trip, which is how this screen is otherwise found.
                    source: from === 'pin' ? 'pin' : 'trip_match',
                  })
          }
          actions={
            <>
              {/* The one action this page never had. Reached from a group's
                  member list — or from anywhere, once you two have a chat —
                  it opens the conversation instead of a request form. */}
              {known ? (
                <PrimaryButton
                  label={`Message ${profile.display_name ?? 'them'}`}
                  onPress={() =>
                    connected
                      ? router.push({
                          pathname: '/chat/[id]',
                          params: { id: directChat!.chat_id },
                        })
                      : router.push({
                          pathname: '/message/[userId]',
                          params: { userId: userId!, name: profile.display_name ?? '' },
                        })
                  }
                />
              ) : null}
              {known ? (
                <PrimaryButton
                  variant="ghost"
                  label="Add to a group"
                  onPress={() =>
                    router.push({
                      pathname: '/add-to-group/[userId]',
                      params: { userId: userId!, name: profile.display_name ?? '' },
                    })
                  }
                />
              ) : null}
              {connected && handlesQuery.isError ? (
                <PrimaryButton
                  variant="ghost"
                  label="Socials didn't load. Try again"
                  onPress={() => handlesQuery.refetch()}
                />
              ) : null}
              {/* Report and Block moved to the nav bar's overflow (above):
                  a stranger's page must not end in Report and Block as its
                  only full-width buttons. */}
              {!known && alreadySaidHi ? (
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.saidHiNote}>
                  You said hi. It&apos;ll be in Chat if they answer.
                </ThemedText>
              ) : null}
            </>
          }
        />
      </ScrollView>
      {/* The one action a stranger's page is FOR, docked where a thumb can
          reach it — it used to be a 26pt chip in a section header while
          Report and Block got the page's only full-width buttons. The bare
          safe-area inset, never tabDockBottom: this is a stacked screen
          with a nav header and no tab bar under it. */}
      {known || from === 'group' ? null : (
        <DockedActionBar
          bottomInset={insets.bottom}
          primaryLabel={
            alreadySaidHi
              ? 'Message sent'
              : helloCapped
                ? 'No first messages left today'
                : `Say hi to ${name}`
          }
          disabled={alreadySaidHi || helloCapped}
          onPrimary={() =>
            userId
              ? openReply({
                  userId,
                  name,
                  photoPath: photos[0]?.storage_path ?? null,
                  // From a pin the venue is not known here, so the anchor is
                  // "a pin" — true and modest. Anywhere else this page is
                  // reached cold it is a trip match, and "their travel
                  // plans" is the one description that is true whether or
                  // not the dates overlap perfectly. Never "your dates
                  // together": room co-members reach this page too, and the
                  // app must not claim dates it cannot show. The bar is off
                  // entirely for group entries (from === 'group'): those are
                  // not trip matches, and send_message_request would refuse
                  // the source at the last step, after the message was
                  // written.
                  target:
                    from === 'pin'
                      ? { key: 'pin:', label: 'their pin' }
                      : { key: 'trip', label: 'their travel plans' },
                  source: from === 'pin' ? 'pin' : 'trip_match',
                })
              : undefined
          }
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    paddingBottom: Space.xxxl,
  },
  centerNote: {
    flex: 1,
    textAlign: 'center',
    textAlignVertical: 'center',
    padding: Space.xl,
  },
  skeleton: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  skeletonText: {
    gap: Space.md,
    padding: Space.lg,
  },
  saidHiNote: {
    textAlign: 'center',
  },
});
