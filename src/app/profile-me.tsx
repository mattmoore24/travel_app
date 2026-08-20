import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BrandDeep, MaxContentWidth, Space } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { deleteAccount } from '@/features/profile/api';
import {
  useLatestVerification,
  useOwnPhotos,
  useOwnProfile,
  useOwnSocialHandles,
} from '@/features/profile/hooks';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { useMyTrips } from '@/features/trips/hooks';
import { isSupabaseConfigured } from '@/lib/supabase';

/** What a signed-out visitor sees when they tap the header avatar. */
function GuestProfile() {
  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.guestContent}>
        <View style={styles.guestHero}>
          <Image
            source={require('@/assets/images/logo-glow.png')}
            style={styles.guestGlow}
            contentFit="contain"
          />
          <View style={styles.guestBadge}>
            <Image
              source={require('@/assets/images/splash-icon.png')}
              style={styles.guestMark}
              contentFit="contain"
            />
          </View>
        </View>
        <ThemedText type="title" style={styles.guestText}>
          You&apos;re browsing as a guest
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.guestText}>
          Make a profile and you can say hi to people, drop pins where you&apos;re headed, and join
          the hostel chats. Takes about a minute.
        </ThemedText>
        <PrimaryButton label="Make my profile" onPress={() => router.push('/join')} />
        <PrimaryButton
          variant="ghost"
          label="I already have an account"
          onPress={() => router.push('/email')}
        />
        <PrimaryButton
          variant="ghost"
          label="House rules"
          onPress={() => router.push('/guidelines')}
        />
      </ScrollView>
    </ThemedView>
  );
}

export default function ProfileScreen() {
  const signedIn = useAuthStore((s) => s.session) != null;
  const { data: profile } = useOwnProfile();
  const { data: photos = [] } = useOwnPhotos();
  const { data: handles = [] } = useOwnSocialHandles();
  const { data: verification } = useLatestVerification();
  const { data: trips = [] } = useMyTrips();

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'person.crop.circle', android: 'person', web: 'person' }}
        title="Profile"
        phase="waiting on backend keys"
        description="Copy .env.example to .env with your Supabase keys, restart the dev server, then sign in."
      />
    );
  }

  if (!signedIn) {
    return <GuestProfile />;
  }
  if (!profile) {
    return <ThemedView style={styles.root} />;
  }

  const profileTrips: ProfileTrip[] = trips.map((trip) => ({
    id: trip.id,
    cityId: trip.city_id,
    cityLabel: `${trip.cities.name}, ${trip.cities.country_name}`,
    startDate: trip.start_date,
    endDate: trip.end_date,
  }));

  return (
    <ThemedView style={styles.root}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.pageContent}>
        {/* Exactly the page a stranger gets, with edit affordances on top —
            the only way to know what your profile actually looks like. */}
        <ProfileView
          profile={profile}
          photos={photos}
          trips={profileTrips}
          handles={handles}
          owner
          onEditSection={(section) =>
            router.push({ pathname: '/edit-profile', params: { section } })
          }
          actions={
            <>
              <PrimaryButton label="Edit profile" onPress={() => router.push('/edit-profile')} />
              {!profile.verified ? (
                <PrimaryButton
                  variant="ghost"
                  label={
                    verification?.status === 'pending' ? 'Verification in review' : 'Get verified'
                  }
                  onPress={() => router.push('/verification')}
                />
              ) : null}
              <PrimaryButton
                variant="ghost"
                label="House rules and help"
                onPress={() => router.push('/guidelines')}
              />
              <PrimaryButton
                variant="ghost"
                label="Sign out"
                onPress={() => {
                  signOut().catch(() => Alert.alert('Sign out failed', 'Please try again.'));
                }}
              />
              {/* App Review 5.1.1(v): account deletion must be available in-app. */}
              <PrimaryButton
                variant="danger"
                label="Delete account"
                onPress={() => {
                  Alert.alert(
                    'Delete your account?',
                    'This permanently removes your profile, photos, trips, pins, and chats (for both sides). It cannot be undone.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete forever',
                        style: 'destructive',
                        onPress: async () => {
                          try {
                            await deleteAccount();
                          } catch {
                            Alert.alert('Deletion failed', 'Check your connection and try again.');
                            return;
                          }
                          // The auth user no longer exists; clear the session.
                          signOut().catch(() => {});
                        },
                      },
                    ]
                  );
                }}
              />
            </>
          }
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  guestContent: {
    padding: Space.lg,
    gap: Space.md,
    alignItems: 'stretch',
    paddingTop: Space.xxl,
  },
  guestHero: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.sm,
  },
  guestGlow: {
    position: 'absolute',
    width: 190,
    height: 190,
  },
  guestBadge: {
    width: 96,
    height: 96,
    borderRadius: 24,
    backgroundColor: BrandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestMark: {
    width: 82,
    height: 82,
  },
  guestText: {
    textAlign: 'center',
  },
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
    gap: Space.lg,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.xxxl,
  },
  // The profile draws its own padding; the scroll view only adds the tail.
  pageContent: {
    paddingBottom: Space.xxxl,
  },
});
