import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, StyleSheet } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Space } from '@/constants/theme';
import { useBlockUser } from '@/features/chat/hooks';
import { useMyChats, useUnlockedSocialHandles } from '@/features/matching/hooks';
import { openReply } from '@/features/matching/respond';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import {
  useProfilePriorities,
  useProfilePrompts,
  usePublicPhotos,
  usePublicProfile,
} from '@/features/profile/hooks';
import { useTravelerTrips } from '@/features/trips/hooks';

/**
 * Another traveler's profile: the same page they see of themselves, minus
 * the edit affordances. Socials appear here once a chat is open — the
 * database decides that, and this screen simply renders whatever comes back
 * (it used to draw a permanent "hidden" card and never ask, which is why
 * handles never showed up after connecting).
 */
export default function PublicProfileScreen() {
  const { userId, from } = useLocalSearchParams<{ userId: string; from?: string }>();
  const profileQuery = usePublicProfile(userId ?? null);
  const photosQuery = usePublicPhotos(userId ?? null);
  const { data: prompts = [] } = useProfilePrompts(userId);
  const { data: priorities = [] } = useProfilePriorities(userId);
  const photos = photosQuery.data ?? [];
  const { data: trips = [] } = useTravelerTrips(userId ?? null);
  const handlesQuery = useUnlockedSocialHandles(userId ?? null);
  const { data: chats = [] } = useMyChats();
  const block = useBlockUser();
  const profile = profileQuery.data;

  const connected = chats.some((chat) => chat.other_user_id === userId);

  if (profileQuery.isSuccess && !profile) {
    return (
      <ThemedView style={styles.root}>
        <ThemedText themeColor="textSecondary" style={styles.centerNote}>
          This traveler isn&apos;t available.
        </ThemedText>
      </ThemedView>
    );
  }
  if (!profile) {
    return <ThemedView style={styles.root} />;
  }

  const profileTrips: ProfileTrip[] = trips.map((trip) => ({
    id: trip.trip_id,
    cityId: trip.city_id,
    cityLabel: `${trip.city_name}, ${trip.city_country}`,
    startDate: trip.start_date,
    endDate: trip.end_date,
  }));

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <ProfileView
          photosPending={photosQuery.data === undefined}
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
            connected || !userId
              ? undefined
              : (target) =>
                  openReply({
                    userId,
                    name: profile.display_name ?? 'Traveler',
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
              {connected && handlesQuery.isError ? (
                <PrimaryButton
                  variant="ghost"
                  label="Socials didn't load. Retry"
                  onPress={() => handlesQuery.refetch()}
                />
              ) : null}
              <PrimaryButton
                variant="ghost"
                label="Report"
                onPress={() =>
                  router.push({ pathname: '/report', params: { userId, context: 'profile' } })
                }
              />
              <PrimaryButton
                variant="danger"
                label="Block"
                onPress={() =>
                  Alert.alert(
                    `Block ${profile.display_name ?? 'this traveler'}?`,
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
                  )
                }
              />
            </>
          }
        />
      </ScrollView>
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
});
