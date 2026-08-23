import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarButton } from '@/components/ui/avatar-button';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useFeaturedPhoto, useFeaturedTraveler, useIsGuest } from '@/features/guest/hooks';
import { useLaunchCities } from '@/features/pins/hooks';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { LoadError } from '@/components/ui/load-error';
import {
  BottomTabInset,
  Elevation,
  HitTarget,
  MaxContentWidth,
  Radius,
  Space,
  Spacing,
  Type,
} from '@/constants/theme';
import {
  useDailySpotlight,
  useMatches,
  useMyChats,
  useSentRequests,
} from '@/features/matching/hooks';
import { usePassedTravelers } from '@/features/matching/passed';
import { useProfilePrompts, usePublicPhotos, usePublicProfile } from '@/features/profile/hooks';
import { openReply } from '@/features/matching/respond';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { formatDate, formatDateRange, toISODate } from '@/features/trips/dates';
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
  const launchCitiesQuery = useLaunchCities();
  const launchCities = launchCitiesQuery.data ?? [];
  const cityId = launchCities[0]?.city_id ?? null;
  const featuredQuery = useFeaturedTraveler(cityId);
  const { data: featured, isPending } = featuredQuery;
  // Not usePhotoUrl: that signs the path with the caller's own credentials,
  // and a guest has none the storage layer will accept. See useFeaturedPhoto.
  const { data: photoUrl } = useFeaturedPhoto(cityId, featured?.photo_path != null);
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    analytics.capture('travelers_viewed', { guest: true });
  }, []);

  // A blank screen, forever, whenever the city list did not load: cityId
  // stayed null, so the featured query never enabled, so isPending never
  // cleared. The one screen a first-time visitor is most likely to open, and
  // it had nothing on it and nothing to say.
  if (launchCitiesQuery.isError || featuredQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        <ProfileCorner />
        <LoadError
          what="travelers"
          error={launchCitiesQuery.error ?? featuredQuery.error}
          onRetry={() => {
            launchCitiesQuery.refetch();
            featuredQuery.refetch();
          }}
        />
      </ThemedView>
    );
  }

  if (isPending || launchCitiesQuery.isPending) {
    return <ThemedView style={styles.root} />;
  }

  return (
    <ThemedView style={styles.root}>
      {/* A guest had the profile entry on Map and Chat and not here, which is
          the exact inconsistency the "reachable from every tab" item exists
          to remove. */}
      <ProfileCorner />
      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + Space.lg, paddingBottom: BottomTabInset + Space.xxl },
        ]}>
        <ThemedText type="title">Travelers</ThemedText>
        {featured ? (
          <>
            {/* Say which one it is. featured_traveler's window is "in town
                within the next two weeks", so a flat "right now" was a claim
                the query does not make: the founder's own test profile showed
                up under it with a trip starting five days later. */}
            <ThemedText type="footnote" themeColor="textSecondary">
              {featured.their_start > toISODate(new Date())
                ? `In ${featured.city_name} from ${formatDate(featured.their_start)}`
                : `In ${featured.city_name} right now`}
            </ThemedText>
            {/* Compact on purpose. This is a teaser with a sign-up card
                under it, and a full-height photo pushed that card off the
                bottom of the screen — where a guest never saw the one thing
                the screen is asking them to do. A guest's feed also arrives
                without photo paths, so the placeholder is the common case
                here, not the rare one. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`Say hi to ${featured.display_name ?? 'this traveler'}`}
              scaleTo={0.98}
              haptic="soft"
              // Brings the gate to them rather than pushing the full profile.
              // The profile route needs an account (its data is not readable
              // signed-out, and widening that to anon would hand every bio in
              // the app to anybody with the URL), so a push would be a tap
              // that silently does nothing. The card already IS the read-only
              // profile in miniature; what it was missing was somewhere for
              // the tap to go, and the answer is the one action available.
              onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}>
              <ThemedView type="backgroundElement" style={styles.card}>
                {/* A hero when there is a face, a monogram row when there is
                    not. The photo is signed for the guest by the
                    featured-photo function rather than by the device: the
                    bucket is private and its only SELECT policy is `to
                    authenticated`, so this is one URL, for the one person the
                    server itself picked, valid five minutes. Widening the
                    bucket to anon would have handed every primary photo in
                    the app to anybody holding the public key, which is why it
                    took a function.

                    It used to be a 48pt circle, and the reason was honest at
                    the time: no face could ever arrive, so a full-height
                    frame was a band of empty colour pushing the sign-up card
                    off the bottom of the screen. Now that a face does arrive,
                    the whole pitch of this screen is that it is a real
                    person, and 3:2 leaves the card comfortably above the tab
                    bar. */}
                {photoUrl ? (
                  <View style={styles.cardHero}>
                    <Image
                      source={{ uri: photoUrl }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                    />
                    <LinearGradient
                      colors={['transparent', 'rgba(2,3,9,0.85)']}
                      locations={[0.4, 1]}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    />
                    <View style={styles.cardHeroText} pointerEvents="none">
                      <View style={styles.nameRow}>
                        <Text style={styles.cardHeroName} numberOfLines={1}>
                          {featured.display_name ?? 'Traveler'}
                          {featured.age != null ? `, ${featured.age}` : ''}
                        </Text>
                        {featured.verified ? (
                          <VerifiedSeal name={featured.display_name} age={featured.age} onPhoto />
                        ) : null}
                      </View>
                    </View>
                  </View>
                ) : null}
                <View style={styles.cardBody}>
                  {photoUrl ? null : (
                    <View style={styles.nameRow}>
                      <View style={[styles.cardMono, { backgroundColor: theme.accentSoft }]}>
                        <ThemedText type="title" style={{ color: theme.accent }}>
                          {(featured.display_name ?? 'T').trim().charAt(0).toUpperCase()}
                        </ThemedText>
                      </View>
                      <ThemedText type="headline" numberOfLines={1} style={styles.nameText}>
                        {featured.display_name ?? 'Traveler'}
                        {featured.age != null ? `, ${featured.age}` : ''}
                      </ThemedText>
                      {featured.verified ? (
                        <VerifiedSeal name={featured.display_name} age={featured.age} />
                      ) : null}
                    </View>
                  )}
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {featured.city_name} ·{' '}
                    {formatDateRange(featured.their_start, featured.their_end)}
                  </ThemedText>
                  {featured.bio ? <ThemedText type="body">{featured.bio}</ThemedText> : null}
                  {/* What the tap does. It said "Tap to see their profile"
                      and then scrolled to the sign-up card, because the
                      profile route is unreadable signed-out — a label that
                      promises the one thing the tap cannot do. */}
                  <ThemedText type="footnote" themeColor="accent">
                    Make a profile to see theirs
                  </ThemedText>
                </View>
              </ThemedView>
            </PressableScale>
          </>
        ) : (
          <ThemedText themeColor="textSecondary">Nobody in town this week.</ThemedText>
        )}
        <SignUpGate
          reason={
            featured
              ? `Make a profile to say hi to ${featured.display_name ?? 'them'}`
              : 'See everyone else in town'
          }
          // Not the reason: that sentence carries a real traveler's name.
          where="travelers-tab"
          cta="Make a profile"
        />
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
  spotlight,
}: {
  candidate: Candidate;
  width: number;
  /** Ribbon copy when this is today's mutual spotlight; null otherwise. */
  spotlight?: string | null;
  onSayHi: () => void;
  onNext: () => void;
  chatId: string | undefined;
  requested: boolean;
}) {
  // Nothing left to open once a message is out or a chat exists.
  const canOpen = chatId == null && !requested;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: profile } = usePublicProfile(candidate.userId);
  const { data: photos = [] } = usePublicPhotos(candidate.userId);
  const { data: trips = [] } = useTravelerTrips(candidate.userId);
  const { data: prompts = [] } = useProfilePrompts(candidate.userId);

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
          // Clearance for the floating Say hi bar AND the tab bar under it.
          // 120 was measured against neither: the last lines of a bio ran
          // straight through the buttons, which is the one place in the app
          // where text and a primary action share pixels.
          paddingBottom: BottomTabInset + ACTION_BAR_CLEARANCE,
        }}
        showsVerticalScrollIndicator={false}>
        {spotlight ? (
          <View style={styles.spotlightRow}>
            <View style={[styles.spotlightChip, { backgroundColor: theme.accentSoft }]}>
              <SymbolView
                name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
                size={13}
                tintColor={theme.accent}
              />
              <ThemedText type="caption" themeColor="accent">
                {spotlight}
              </ThemedText>
            </View>
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.spotlightNote}>
              You&apos;re top of their list too.
            </ThemedText>
          </View>
        ) : null}
        <ProfileView
          profile={shown}
          photos={shownPhotos}
          prompts={prompts}
          trips={profileTrips}
          handles={[]}
          owner={false}
          onRespondTo={
            canOpen
              ? (target) =>
                  openReply({
                    userId: candidate.userId,
                    name: shown.display_name ?? 'Traveler',
                    photoPath: candidate.match.photo_path ?? null,
                    target,
                    // This tab only ever shows people whose trip overlaps
                    // yours, which is exactly what the trip_match check wants.
                    source: 'trip_match',
                  })
              : undefined
          }
        />
      </ScrollView>

      {/* The bar floats over a scrolling photo-and-text page, so it needs a
          ground of its own or the words behind it compete with the words on
          it. Transparent to canvas, tall enough to cover the bar and the tab
          bar below it, and inert to touch. */}
      <LinearGradient
        colors={['transparent', theme.background]}
        locations={[0, 0.55]}
        style={[
          styles.actionBackdrop,
          { height: actionBarHeight(insets.bottom) + ACTION_BAR_RAMP },
        ]}
        pointerEvents="none"
      />
      <View
        style={[styles.actionBar, { paddingBottom: BottomTabInset + insets.bottom / 2 + Space.sm }]}
        pointerEvents="box-none">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Next traveler"
          haptic="light"
          scaleTo={0.94}
          onPress={onNext}
          style={[
            styles.nextButton,
            { backgroundColor: theme.surfaceSunken, borderColor: theme.hairline },
          ]}>
          <SymbolView
            name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
            size={18}
            tintColor={theme.text}
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

/**
 * Room under the scroll for the floating Say hi bar and the tab bar beneath
 * it, so anything at the very bottom of a profile can still be scrolled into
 * the clear.
 */
const ACTION_BAR_CLEARANCE = 148;

/** The Say hi button's diameter, and the Next circle's. */
const ACTION_BUTTON = 52;

/**
 * How tall the bar actually is. The backdrop used to be given
 * ACTION_BAR_CLEARANCE instead, which is 30pt taller — so the fade started
 * a line and a half ABOVE the bar and dissolved whatever was there. On a
 * traveler with one trip that is exactly where "Both there Aug 23 - 28"
 * lands: the one fact that explains why this person is on your screen,
 * sliced in half at rest (run 44). Scrolling recovered it; nothing told you
 * to scroll.
 */
function actionBarHeight(bottomInset: number) {
  return Space.sm + ACTION_BUTTON + Space.sm + BottomTabInset + bottomInset / 2;
}

/** Ramp above the bar. Long enough to read as a fade, short enough that it
 *  starts at the bar rather than over the content. */
const ACTION_BAR_RAMP = Space.xxl;

/**
 * The way to your own profile, on this tab too.
 *
 * It used to exist only on the Map, which made Edit profile, Get verified,
 * House rules, Sign out and Delete account reachable from exactly one of
 * three tabs — and this screen's own empty state said "your trips live on
 * your profile" while offering no way to get there.
 */
function ProfileCorner() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.profileCorner, { top: insets.top + Space.sm }]} pointerEvents="box-none">
      <AvatarButton />
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
  const { data: spotlight } = useDailySpotlight();

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
  const spotlightId = spotlight?.user_id ?? null;
  const queue = [...byUser.values()].filter(
    (candidate) =>
      !passed.has(candidate.userId) &&
      !chatByUser.has(candidate.userId) &&
      // Somebody you have already said hi to is not a decision you still
      // have to make. Leaving them at the front of the queue behind a
      // greyed-out "Message sent" turned the send into a dead end: the one
      // moment the app should hand you the next person, it handed you a
      // disabled button. The hello lives in Chat under "You said hi".
      !sentByRecipient.has(candidate.userId)
  );
  // Today's spotlight goes to the front, if they are still in the queue.
  // The point of it is that the SAME pairing is shown to both people on the
  // same day: a recommendation only one side can see is one nobody acts on,
  // because the person acting has no reason to expect a warmer reception.
  if (spotlightId) {
    const at = queue.findIndex((candidate) => candidate.userId === spotlightId);
    if (at > 0) {
      queue.unshift(...queue.splice(at, 1));
    }
  }
  // No cursor: passing someone removes them from the queue, so the next
  // person slides into the same slot. Advancing an index as well is what
  // would skip every second traveler.
  const current = queue[0];

  // The shape of a traveler, rather than a blank frame. It was already
  // right not to say "add a trip first" while still asking; this at least
  // says something is coming.
  if (tripsQuery.isPending || matchesQuery.isPending) {
    return (
      <ThemedView style={styles.root}>
        <ProfileCorner />
        <View style={[styles.loading, { paddingTop: insets.top + Space.sm }]}>
          <Skeleton width="100%" height={Math.min(width, MaxContentWidth) * 1.15} radius={16} />
          <Skeleton width="60%" height={16} />
          <Skeleton width="85%" height={12} />
          <Skeleton width="70%" height={12} />
        </View>
      </ThemedView>
    );
  }

  // And never "add a trip first" when the question failed. Somebody with a
  // Lisbon trip already posted, offline, was being told as a fact that they
  // had none.
  if (tripsQuery.isError || matchesQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        {/* This one can sit on screen for as long as the phone is offline. */}
        <ProfileCorner />
        <LoadError
          what="your travelers"
          error={tripsQuery.error ?? matchesQuery.error}
          onRetry={() => {
            tripsQuery.refetch();
            matchesQuery.refetch();
          }}
        />
      </ThemedView>
    );
  }

  if (trips.length === 0) {
    return (
      <ThemedView style={styles.root}>
        <ProfileCorner />
        <View style={[styles.empty, { paddingTop: insets.top + Space.xxl }]}>
          <ThemedText type="title" style={styles.emptyText}>
            Add a trip first
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            You&apos;ll see who&apos;s in town on your dates.
          </ThemedText>
          {/* Straight to the fix. Sending someone to their profile to hunt
              for the button is one hop of homework between a person and the
              thing this screen just told them they need. */}
          <PrimaryButton label="Add a trip" onPress={() => router.push('/add-trip')} />
        </View>
      </ThemedView>
    );
  }

  if (queue.length === 0 || !current) {
    // An exhausted queue is a supply problem, so this screen offers the
    // three things that actually create supply rather than apologising and
    // stopping. Naming the city and the window also makes the emptiness
    // legible: "nobody, ever" and "nobody whose Bangkok dates cross mine
    // this week" are very different messages, and only one of them is true.
    const cityNames = Array.from(new Set(trips.map((trip) => trip.cities.name)));
    const headline =
      cityNames.length === 1
        ? `That's everyone in ${cityNames[0]} with travel plans matching yours`
        : "That's everyone with travel plans matching yours";
    return (
      <ThemedView style={styles.root}>
        <ProfileCorner />
        {/* Clear of the avatar, not level with it. ProfileCorner sits at
            insets.top + Space.sm and is a 44pt button, so Space.xxl put the
            headline's first line straight through its lower half. */}
        <View style={[styles.empty, { paddingTop: insets.top + Space.sm + HitTarget + Space.lg }]}>
          <ThemedText type="title" style={styles.emptyText}>
            {headline}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.emptyText}>
            More show up every day.
          </ThemedText>
          {/* navigate, not push: pushing '/(tabs)' from inside the tabs
              stacks a SECOND copy of the whole tab navigator on the root
              stack rather than switching to Map, so the way back was a
              gesture nobody would guess at. */}
          <PrimaryButton label="Drop a pin" onPress={() => router.navigate('/(tabs)')} />
          <PrimaryButton
            variant="ghost"
            label="Add another trip"
            onPress={() => router.push('/add-trip')}
          />
          {passed.count > 0 ? (
            <PrimaryButton variant="ghost" label="See them again" onPress={() => passed.reset()} />
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
      <ProfileCorner />
      <Animated.View entering={FadeIn.duration(200)} style={styles.deck} key={current.userId}>
        <TravelerPage
          spotlight={current.userId === spotlightId ? `Today in ${current.match.city_name}` : null}
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
            // Anchored even on the lazy path. Every hello now opens pointed
            // at something specific, and when nothing on the profile has been
            // tapped the something is the fact that put these two people in
            // front of each other: the dates they share. A first message
            // with an anchor is easier to write, easier for the recipient to
            // answer, and easier for moderation to read in context.
            const overlap = [...current.overlaps.values()][0];
            openReply({
              userId: current.userId,
              name: current.match.display_name ?? 'Traveler',
              photoPath: current.match.photo_path ?? null,
              source: 'trip_match',
              target: overlap
                ? {
                    key: 'trip',
                    label: 'your dates together',
                    quote: `Both in ${current.match.city_name} ${formatDateRange(
                      overlap.start,
                      overlap.end
                    )}`,
                  }
                : { key: 'bio', label: 'their bio' },
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
  profileCorner: {
    position: 'absolute',
    right: Space.lg,
    zIndex: 5,
  },
  spotlightRow: {
    alignItems: 'center',
    gap: Space.xs,
    paddingBottom: Space.md,
  },
  spotlightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  spotlightNote: {
    textAlign: 'center',
  },
  loading: {
    flex: 1,
    // NOT alignSelf: 'center'. The root is flexDirection: 'row', so the cross
    // axis is vertical — centring on it gave the skeleton column content
    // height, floated it down the middle of the screen, and made its
    // paddingTop (the notch clearance) do nothing. The real list stretches;
    // its placeholder has to stretch the same way or the shimmer appears
    // somewhere the content never does.
    width: '100%',
    maxWidth: MaxContentWidth,
    gap: Space.md,
    paddingHorizontal: Space.lg,
  },
  actionBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
    // Themed, not the warm brown it carried over from the pre-Nocturne
    // palette, which read as a mud-coloured smudge beside the blue button.
    borderWidth: StyleSheet.hairlineWidth,
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
    borderRadius: Radius.lg,
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
  cardMono: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardHero: {
    aspectRatio: 3 / 2,
    justifyContent: 'flex-end',
  },
  cardHeroText: {
    padding: Space.lg,
  },
  cardHeroName: {
    ...Type.headline,
    color: '#FFFFFF',
  },
  cardBody: {
    padding: Space.lg,
    gap: Space.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  nameText: {
    fontSize: 16,
    // Shrinks rather than pushing the verified seal off the row, now that a
    // 48pt monogram shares the line with it.
    flexShrink: 1,
  },
});
