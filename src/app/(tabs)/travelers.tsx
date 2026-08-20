import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useFeaturedTraveler, useIsGuest } from '@/features/guest/hooks';
import { useLaunchCities } from '@/features/pins/hooks';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import {
  BottomTabInset,
  Elevation,
  MaxContentWidth,
  Radius,
  Space,
  Spacing,
} from '@/constants/theme';
import { useMatches, useMyChats, useSentRequests } from '@/features/matching/hooks';
import { usePassedTravelers } from '@/features/matching/passed';
import { usePhotoUrl, usePublicPhotos, usePublicProfile } from '@/features/profile/hooks';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { formatDateRange } from '@/features/trips/dates';
import { useMyTrips, useTravelerTrips } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import type { MatchRow } from '@/lib/database.types';
import { isSupabaseConfigured } from '@/lib/supabase';

/** One traveler and every window the two of you share. */
type Candidate = {
  userId: string;
  match: MatchRow;
  overlaps: Map<string, { start: string; end: string }>;
};

/**
 * What a signed-out visitor sees: the single traveler people are connecting
 * with most in this city right now, then the gate. Seeing one real person is
 * the whole pitch — the account comes after that lands (docs/DESIGN.md).
 */
function GuestTravelers() {
  const insets = useSafeAreaInsets();
  const { data: launchCities = [] } = useLaunchCities();
  const cityId = launchCities[0]?.city_id ?? null;
  const { data: featured, isPending } = useFeaturedTraveler(cityId);
  const { data: photoUrl } = usePhotoUrl(featured?.photo_path ?? null);
  const theme = useTheme();

  useEffect(() => {
    analytics.capture('travelers_viewed', { guest: true });
  }, []);

  if (isPending) {
    return <ThemedView style={styles.root} />;
  }

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.xxl },
        ]}>
        <ThemedText type="title">Travelers</ThemedText>
        {featured ? (
          <>
            <ThemedText type="footnote" themeColor="textSecondary">
              In {featured.city_name} right now
            </ThemedText>
            <ThemedView type="backgroundElement" style={styles.card}>
              <View style={[styles.cardPhoto, { backgroundColor: theme.backgroundSelected }]}>
                {photoUrl ? (
                  <Image source={{ uri: photoUrl }} style={styles.cardImage} contentFit="cover" />
                ) : null}
              </View>
              <View style={styles.cardBody}>
                <View style={styles.nameRow}>
                  <ThemedText type="headline" style={styles.nameText}>
                    {featured.display_name ?? 'Traveler'}
                    {featured.age != null ? `, ${featured.age}` : ''}
                  </ThemedText>
                  {featured.verified ? (
                    <SymbolView
                      name={{ ios: 'checkmark.seal.fill', android: 'verified', web: 'verified' }}
                      size={14}
                      tintColor={theme.accent}
                    />
                  ) : null}
                </View>
                <ThemedText type="footnote" themeColor="textSecondary">
                  {featured.city_name} · {formatDateRange(featured.their_start, featured.their_end)}
                </ThemedText>
                {featured.bio ? <ThemedText type="body">{featured.bio}</ThemedText> : null}
              </View>
            </ThemedView>
          </>
        ) : (
          <ThemedText themeColor="textSecondary">No travelers in town this week yet.</ThemedText>
        )}
        <SignUpGate reason="See everyone else in town" cta="Make a profile" />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * One traveler, full page, with the dates you share called out on their
 * trips. Reading one person at a time is the point: a list of everybody
 * turns into a grid nobody reads, and a profile you actually look at is what
 * makes a first message worth sending (founder review).
 */
function TravelerPage({
  candidate,
  width,
  onSayHi,
  onNext,
  chatId,
  requested,
}: {
  candidate: Candidate;
  width: number;
  onSayHi: () => void;
  onNext: () => void;
  chatId: string | undefined;
  requested: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { data: profile } = usePublicProfile(candidate.userId);
  const { data: photos = [] } = usePublicPhotos(candidate.userId);
  const { data: trips = [] } = useTravelerTrips(candidate.userId);

  // Fall back to what the match row already carries, so the page has a name
  // and a photo before the profile query lands.
  const fallback = {
    user_id: candidate.userId,
    display_name: candidate.match.display_name,
    age: candidate.match.age,
    home_city: null,
    home_country: null,
    languages: candidate.match.languages,
    bio: candidate.match.bio,
    occupation: candidate.match.occupation,
    gender: candidate.match.gender,
    verified: candidate.match.verified,
    onboarding_completed_at: null,
    created_at: '',
    updated_at: '',
  };
  const shown = profile ?? fallback;
  const shownPhotos =
    photos.length > 0
      ? photos
      : candidate.match.photo_path
        ? [
            {
              id: 'match-photo',
              user_id: candidate.userId,
              storage_path: candidate.match.photo_path,
              position: 0,
              moderation_status: 'approved' as const,
              moderation_attempts: 0,
              created_at: '',
            },
          ]
        : [];

  const profileTrips: ProfileTrip[] = (
    trips.length > 0
      ? trips.map((trip) => ({
          id: trip.trip_id,
          cityId: trip.city_id,
          cityLabel: `${trip.city_name}, ${trip.city_country}`,
          startDate: trip.start_date,
          endDate: trip.end_date,
        }))
      : [
          {
            id: candidate.match.trip_id,
            cityId: candidate.match.city_id,
            cityLabel: `${candidate.match.city_name}, ${candidate.match.city_country}`,
            startDate: candidate.match.their_start,
            endDate: candidate.match.their_end,
          },
        ]
  ).map((trip) => ({ ...trip, overlap: candidate.overlaps.get(trip.id) ?? null }));

  return (
    <View style={[styles.page, { width }]}>
      <ScrollView
        // Headroom for the notch. This screen has no navigation header, so
        // without it the hero photo starts at y=0 and the top of every
        // traveler's face is clipped by the status bar.
        contentContainerStyle={{
          paddingTop: insets.top + Space.sm,
          paddingBottom: BottomTabInset + 120,
        }}
        showsVerticalScrollIndicator={false}>
        <ProfileView
          profile={shown}
          photos={shownPhotos}
          trips={profileTrips}
          handles={[]}
          owner={false}
        />
      </ScrollView>

      <View
        style={[styles.actionBar, { paddingBottom: BottomTabInset + insets.bottom / 2 + Space.sm }]}
        pointerEvents="box-none">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Next traveler"
          haptic="light"
          scaleTo={0.94}
          onPress={onNext}
          style={styles.nextButton}>
          <SymbolView
            name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
            size={18}
            tintColor="#FFFFFF"
          />
        </PressableScale>
        <View style={styles.sayHiWrap}>
          <PrimaryButton
            label={chatId ? 'Open chat' : requested ? 'Message sent' : 'Say hi'}
            disabled={requested && !chatId}
            onPress={onSayHi}
          />
        </View>
      </View>
    </View>
  );
}

export default function TravelersScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isGuest = useIsGuest();
  const tripsQuery = useMyTrips();
  const matchesQuery = useMatches();
  const trips = tripsQuery.data ?? [];
  const matches = matchesQuery.data ?? [];
  const { data: sentRequests = [] } = useSentRequests();
  const { data: chats = [] } = useMyChats();
  const passed = usePassedTravelers();

  useEffect(() => {
    analytics.capture('travelers_viewed');
  }, []);

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
        title="Travelers"
        phase="waiting on backend keys"
        description="Add Supabase keys to .env to post trips and browse travelers."
      />
    );
  }

  if (isGuest) {
    return <GuestTravelers />;
  }

  const sentByRecipient = new Map(sentRequests.map((r) => [r.recipient_id, r]));
  const chatByUser = new Map(
    chats.filter((c) => c.chat_status === 'active').map((c) => [c.other_user_id, c.chat_id])
  );

  // Every overlapping trip, kept per traveler rather than collapsed to one.
  const byUser = new Map<string, Candidate>();
  for (const match of matches) {
    const existing = byUser.get(match.user_id);
    const entry = existing ?? { userId: match.user_id, match, overlaps: new Map() };
    entry.overlaps.set(match.trip_id, {
      start: match.overlap_start,
      end: match.overlap_end,
    });
    byUser.set(match.user_id, entry);
  }
  const queue = [...byUser.values()].filter(
    (candidate) => !passed.has(candidate.userId) && !chatByUser.has(candidate.userId)
  );
  // No cursor: passing someone removes them from the queue, so the next
  // person slides into the same slot. Advancing an index as well is what
  // would skip every second traveler.
  const current = queue[0];

  // Blank frame rather than "add a trip first" while we are still asking.
  if (tripsQuery.isPending || matchesQuery.isPending) {
    return <ThemedView style={styles.root} />;
  }

  if (trips.length === 0) {
    return (
      <ThemedView style={styles.root}>
        <View style={[styles.empty, { paddingTop: insets.top + Space.xxl }]}>
          <ThemedText type="title" style={styles.emptyText}>
            Add a trip first
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            Travelers here are the people who will be in the same city as you, on the same dates.
            Your trips live on your profile.
          </ThemedText>
          <PrimaryButton label="Go to my profile" onPress={() => router.push('/profile-me')} />
        </View>
      </ThemedView>
    );
  }

  if (queue.length === 0 || !current) {
    return (
      <ThemedView style={styles.root}>
        <View style={[styles.empty, { paddingTop: insets.top + Space.xxl }]}>
          <ThemedText type="title" style={styles.emptyText}>
            That is everyone for now
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            More people add trips every day. Check back, or add another city to your plans.
          </ThemedText>
          {passed.count > 0 ? (
            <PrimaryButton
              variant="ghost"
              label="Look through them again"
              onPress={() => passed.reset()}
            />
          ) : null}
        </View>
      </ThemedView>
    );
  }

  const sent = sentByRecipient.get(current.userId);
  const chatId =
    chatByUser.get(current.userId) ??
    (sent?.state === 'accepted' ? (sent.chat_id ?? undefined) : undefined);

  return (
    <ThemedView style={styles.root}>
      <Animated.View entering={FadeIn.duration(200)} style={styles.deck} key={current.userId}>
        <TravelerPage
          candidate={current}
          width={Math.min(width, MaxContentWidth)}
          chatId={chatId}
          requested={sent?.state === 'sent'}
          onNext={() => {
            haptics.selection();
            passed.add(current.userId);
          }}
          onSayHi={() => {
            if (chatId) {
              router.push(`/chat/${chatId}`);
              return;
            }
            router.push({
              pathname: '/compose-request',
              params: {
                userId: current.userId,
                name: current.match.display_name ?? 'Traveler',
                photoPath: current.match.photo_path ?? '',
                source: 'trip_match',
              },
            });
          }}
        />
      </Animated.View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  page: {
    flex: 1,
  },
  actionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
  },
  nextButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(33,30,26,0.72)',
  },
  sayHiWrap: {
    flex: 1,
  },
  empty: {
    flex: 1,
    gap: Space.md,
    padding: Space.lg,
    alignItems: 'stretch',
  },
  emptyText: {
    textAlign: 'center',
  },
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  listContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  headerBlock: {
    gap: Spacing.three,
    marginBottom: Spacing.two,
  },
  tripsRow: {
    marginHorizontal: -Spacing.four,
  },
  tripsScroll: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  tripChip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
    alignItems: 'center',
    gap: 2,
  },
  addTrip: {
    justifyContent: 'center',
  },
  card: {
    borderRadius: Radius.xl,
    overflow: 'hidden',
    ...Elevation.raised,
  },
  cardPhoto: {
    width: '100%',
    aspectRatio: 4 / 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardBody: {
    padding: Space.lg,
    gap: Space.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  nameText: {
    fontSize: 16,
  },
});
