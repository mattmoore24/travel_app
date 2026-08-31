import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarButton } from '@/components/ui/avatar-button';
import {
  ACTION_BUTTON,
  BAR_SCALE_CAP,
  DockedActionBar,
  dockedActionBarHeight,
} from '@/components/ui/docked-action-bar';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { guestEmptyCityLine, guestGateReason } from '@/features/guest/copy';
import {
  useFeaturedPhoto,
  useFeaturedTraveler,
  useIsGuest,
  useMapPins,
} from '@/features/guest/hooks';
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
  Motion,
  Radius,
  Space,
  Spacing,
  Type,
  tabDockBottom,
} from '@/constants/theme';
import {
  useDailySpotlight,
  useFirstMessageBudget,
  useMatches,
  useMyChats,
  useSentRequests,
} from '@/features/matching/hooks';
import { usePassedTravelers } from '@/features/matching/passed';
import { remainingLine } from '@/features/matching/queue-copy';
import { sharedTodayNote } from '@/features/matching/spotlight';
import { AUDIENCE_LABEL, audienceInSentence } from '@/features/profile/audience';
import {
  useOwnVisibility,
  useProfilePriorities,
  useProfilePrompts,
  usePublicPhotos,
  usePublicProfile,
} from '@/features/profile/hooks';
import { openReply } from '@/features/matching/respond';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { formatDate, formatDateRange, toISODate } from '@/features/trips/dates';
import { useMyTrips, useTravelerTrips } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { countOf } from '@/lib/plural';
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
  const cityName = launchCities[0]?.cities?.name ?? null;
  const featuredQuery = useFeaturedTraveler(cityId);
  const { data: featured, isPending } = featuredQuery;
  // Evidence for the empty branch: the same faceless rows the guest map
  // already serves, counted. Never individual pins — a real traveler's venue
  // plus date is not guest content.
  const { data: cityPins = [] } = useMapPins(cityId);
  // Not usePhotoUrl: that signs the path with the caller's own credentials,
  // and a guest has none the storage layer will accept. See useFeaturedPhoto.
  const { data: photoUrl } = useFeaturedPhoto(cityId, featured?.photo_path != null);
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);

  // No capture here: the parent screen fires travelers_viewed exactly once,
  // carrying the guest flag, for both audiences. This component used to fire
  // its own copy, so every guest counted twice and the parent's untagged
  // event made `guest != true` filters keep them.

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
                : `In ${featured.city_name} this week`}
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
              // Inside a scroller: a touch-down haptic fires on a flick past
              // the card, and scrolling must not buzz. PressableScale's own
              // doc comment states the rule.
              haptic="none"
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
                    {/* Top-weighted: the frame is 3:2 landscape and the photo
                        is usually a portrait selfie whose face sits high, so
                        the default centre crop lost the top of the head. */}
                    <Image
                      source={{ uri: photoUrl }}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      contentPosition="top"
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
          <ThemedText themeColor="textSecondary">
            {guestEmptyCityLine(cityPins.length, cityName)}
          </ThemedText>
        )}
        <SignUpGate
          // Both branches come from one function of `featured`, so the empty
          // branch can never again promise "everyone else" under a line that
          // just said there is nobody.
          reason={guestGateReason(featured?.display_name, featured != null, cityName)}
          // Not the reason: that sentence carries a real traveler's name.
          where="travelers-tab"
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
  isSpotlight,
  helloCapped,
  remaining,
  refreshing,
  onRefresh,
}: {
  candidate: Candidate;
  width: number;
  /**
   * True when this is today's mutual spotlight. The ribbon copy is built HERE
   * rather than passed in, because the note names the traveler and a prepared
   * string let the old ceremony line ("You're top of their list too.") sit in
   * the parent where nothing about it looked like copy.
   */
  isSpotlight?: boolean;
  /** How many people are behind this one in the queue. */
  remaining: number;
  refreshing: boolean;
  onRefresh: () => void;
  onSayHi: () => void;
  onNext: () => void;
  chatId: string | undefined;
  requested: boolean;
  /** No hellos left today — the Say hi button says so instead of opening. */
  helloCapped: boolean;
}) {
  // Nothing left to open once a message is out or a chat exists.
  const canOpen = chatId == null && !requested;
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { data: profile } = usePublicProfile(candidate.userId);
  const { data: photos = [] } = usePublicPhotos(candidate.userId);
  const { data: trips = [] } = useTravelerTrips(candidate.userId);
  const { data: prompts = [] } = useProfilePrompts(candidate.userId);
  const { data: priorities = [] } = useProfilePriorities(candidate.userId);

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
      {/* A fixed header, outside the scroller, so the scope of the queue is
          readable on every traveler and does not scroll away with the page.
          Headroom for the notch: this screen has no navigation header, so
          without the inset the first line starts at y=0 under the status
          bar. */}
      <View style={[styles.queueHeader, { paddingTop: insets.top + Space.sm }]}>
        {isSpotlight ? (
          <>
            <View style={[styles.spotlightChip, { backgroundColor: theme.accentSoft }]}>
              <SymbolView
                name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
                size={13}
                tintColor={theme.accent}
              />
              <ThemedText type="caption" themeColor="accent">
                {`Today in ${candidate.match.city_name}`}
              </ThemedText>
            </View>
            {/* States the mechanism, not a ranking. daily_spotlights is a
                canonically ordered pair with one row per person per day, so
                "shown to you and them" is exactly what the table guarantees.
                The line it replaced ("You're top of their list too.") claimed
                a named stranger had ranked the reader, which is the
                reciprocal-interest reveal the product exists to avoid. */}
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.sharedTodayNote}>
              {sharedTodayNote(shown.display_name)}
            </ThemedText>
          </>
        ) : null}
        {/* The scope of the queue, not of the city: this count is already
            filtered by passes, chats, hellos sent and the viewer's own
            audience setting, and the words are careful to claim no more. */}
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.sharedTodayNote}>
          {remainingLine(remaining, candidate.match.city_name)}
        </ThemedText>
      </View>
      <ScrollView
        refreshControl={
          // The one gesture people reflexively make at the top of a feed,
          // and the recovery for a queue that emptied while you read it.
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.textSecondary}
          />
        }
        contentContainerStyle={{
          paddingTop: Space.sm,
          // Clearance for the floating Say hi bar AND the tab bar under it,
          // DERIVED from the bar's real height so it cannot silently go
          // short the moment the bar grows. The magic 148 this replaces was
          // double-counting BottomTabInset (198 of padding for a 135pt bar).
          paddingBottom: actionBarHeight(insets.bottom) + Space.xl,
        }}
        showsVerticalScrollIndicator={false}>
        <ProfileView
          profile={shown}
          photos={shownPhotos}
          prompts={prompts}
          priorities={priorities}
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

      {/* The floating action bar, extracted to components/ui/docked-action-bar
          so the map's pin-reached profile docks the same chrome. The plate,
          the ramp, and the hit-testing rules all live there now. */}
      <DockedActionBar
        bottomInset={tabDockBottom(insets.bottom)}
        // PrimaryButton renders disabled as a surfaceSunken fill with a
        // textSecondary label (8.2:1), not a fade, so "No hellos left
        // today" stays legible while it says not-now. Opening an existing
        // chat is not a hello, so the cap never touches that state.
        primaryLabel={
          chatId
            ? 'Open chat'
            : requested
              ? 'Message sent'
              : helloCapped
                ? 'No first messages left today'
                : 'Say hi'
        }
        disabled={!chatId && (requested || helloCapped)}
        onPrimary={onSayHi}
        secondary={
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Next traveler"
            haptic="light"
            scaleTo={0.94}
            onPress={onNext}
            style={[
              styles.nextButton,
              // `border`, not `hairline`: this is an edge a user must see on a
              // control, and hairline is the token the theme reserves for
              // decorative dividers (1.41:1 here).
              { backgroundColor: theme.surfaceSunken, borderColor: theme.border },
            ]}>
            <SymbolView
              name={{ ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' }}
              size={18}
              tintColor={theme.text}
            />
            <ThemedText
              type="caption"
              themeColor="textSecondary"
              maxFontSizeMultiplier={BAR_SCALE_CAP}>
              Next
            </ThemedText>
          </PressableScale>
        }
      />
    </View>
  );
}

/**
 * How tall the bar actually is — and therefore where the scroll clearance
 * comes from. Defined ON tabDockBottom so this bar and the Map's "Drop a
 * pin" pill can never again sit at two heights on one phone (the old
 * expression halved the safe-area inset, a 17pt drift). The base formula
 * lives with the bar in components/ui/docked-action-bar.
 */
export function actionBarHeight(bottomInset: number) {
  return dockedActionBarHeight(tabDockBottom(bottomInset));
}

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
  // Today's hello budget, so the Say hi button can say "none left" instead
  // of opening a composer that cannot send (see compose-request's own guard).
  const budget = useFirstMessageBudget();
  // The undo for a mis-tapped Next: who was just passed (for the bar) and
  // who was just brought back (so the queue re-opens on them, not on
  // whoever happens to sort first). Declared with the other hooks, above
  // every early return, so hook order stays stable.
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [restoredId, setRestoredId] = useState<string | null>(null);
  // Held in a ref and cleared on unmount and on the next pass, so a timer
  // never outlives the screen or dismisses the wrong bar.
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (undoTimer.current) {
        clearTimeout(undoTimer.current);
      }
    },
    []
  );
  // Above every early return, so hook order stays stable. This screen used
  // to have no idea the setting existed, which is why an empty queue said
  // "that's everyone" whatever the reason.
  const { data: audience = 'everyone' } = useOwnVisibility();

  // Destructured because a query RESULT is a new object every render while
  // its refetch is stable — same pattern as chat.tsx, for the same reason.
  const { refetch: refetchTrips } = tripsQuery;
  const { refetch: refetchMatches } = matchesQuery;
  const refresh = useCallback(() => {
    refetchTrips();
    refetchMatches();
  }, [refetchTrips, refetchMatches]);
  // The queue changes while this tab is off-stage: trips get added, people
  // arrive, hellos get answered. Without this a queue that emptied stayed
  // empty until a force-quit, on the one screen with no other way back in.
  useFocusEffect(refresh);

  // The one travelers_viewed for both audiences, always tagged: matching DAU
  // is counted as `guest = false` on this event (docs/DASHBOARD.md), and an
  // untagged copy would put every guest back into it. Once per MOUNT, by ref:
  // a guest upgrade flips isGuest in place (updateUser on the same anonymous
  // session, no sign-out), and a deps-driven refire would count one view as
  // both audiences.
  const viewedOnce = useRef(false);
  useEffect(() => {
    if (viewedOnce.current) {
      return;
    }
    viewedOnce.current = true;
    analytics.capture('travelers_viewed', { guest: isGuest });
  }, [isGuest]);

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

  // `state === 'blocked'` is a hello the moderation pre-filter refused. It was
  // never delivered, the other person has no idea it happened, and the row is
  // kept only so the sender can be told why — so counting it as "you already
  // said hi" quietly deleted that traveler from the queue for good, with no
  // way back and nothing on screen to explain it.
  const sentByRecipient = new Map(
    sentRequests.filter((r) => r.state !== 'blocked').map((r) => [r.recipient_id, r])
  );
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
  // An undone pass outranks the spotlight (hence after it): Undo has to
  // return the person you just passed, not whoever happens to sort first.
  // The id is cleared on the next pass; while they are current the hoist is
  // a no-op, and once they leave the queue (passed again, said hi) the
  // findIndex misses and nothing moves.
  if (restoredId) {
    const at = queue.findIndex((candidate) => candidate.userId === restoredId);
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
          {/* The second half of the sentence signup started. Step 10's skip
              says "Travelers stays closed until you do.", so the wall echoes
              those words instead of arriving as a surprise with no memory
              that the skip was a choice. */}
          <ThemedText type="title" style={styles.emptyText}>
            Travelers opens once you add a trip
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
    // The third reason a queue can be empty, and the one this screen used to
    // state the opposite of. "That's everyone" is a claim about supply; when
    // the viewer's own audience is what removed people, it is simply false,
    // and the founder read it and reported the filter as broken. Nothing on
    // the screen led back to the setting either: all three buttons were
    // supply actions.
    const filtered = audience !== 'everyone';
    const headline = filtered
      ? cityNames.length === 1
        ? `Nobody in ${cityNames[0]} fits who you asked to see`
        : 'Nobody on your dates fits who you asked to see'
      : cityNames.length === 1
        ? `That's everyone in ${cityNames[0]} with travel plans matching yours`
        : "That's everyone with travel plans matching yours";
    const body = filtered
      ? `You are set to ${audienceInSentence(audience)}. It works both ways, so this hides you from everyone else too.`
      : 'More show up every day.';
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
            {body}
          </ThemedText>
          {/* navigate, not push: pushing '/(tabs)' from inside the tabs
              stacks a SECOND copy of the whole tab navigator on the root
              stack rather than switching to Map, so the way back was a
              gesture nobody would guess at. */}
          {filtered ? (
            <PrimaryButton
              label={`Change who you see (${AUDIENCE_LABEL[audience]})`}
              onPress={() => router.push('/visibility')}
            />
          ) : null}
          <PrimaryButton
            variant={filtered ? 'ghost' : undefined}
            label="Drop a pin"
            onPress={() => router.navigate('/(tabs)')}
          />
          <PrimaryButton
            variant="ghost"
            label="Add another trip"
            onPress={() => router.push('/add-trip')}
          />
          {passed.count > 0 ? (
            // All-or-nothing is right when the queue is already empty, but
            // the count belongs in the sentence: an unnumbered "them" made
            // this read like a rewind of everything rather than the small,
            // specific act it is.
            <PrimaryButton
              variant="ghost"
              label={`Show the ${countOf(passed.count, 'person', 'people')} you skipped`}
              onPress={() => {
                // The undo bar outlives the queue: passing the LAST person
                // empties the deck-free list while the 5s window still runs,
                // and reset() would re-render the main return with a bar for
                // a pass this very tap already restored.
                if (undoTimer.current) {
                  clearTimeout(undoTimer.current);
                  undoTimer.current = null;
                }
                setUndo(null);
                passed.reset();
              }}
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
  // Out of hellos for today. Opening an existing chat is not a hello, so
  // the cap never touches the Open chat state.
  const helloCapped = budget.data != null && budget.data.used >= budget.data.allowed;

  const undoPass = () => {
    if (!undo) {
      return;
    }
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    haptics.selection();
    passed.remove(undo.id);
    setRestoredId(undo.id);
    setUndo(null);
  };

  return (
    <ThemedView style={styles.root}>
      <ProfileCorner />
      <Animated.View entering={FadeIn.duration(200)} style={styles.deck} key={current.userId}>
        <TravelerPage
          isSpotlight={current.userId === spotlightId}
          candidate={current}
          width={Math.min(width, MaxContentWidth)}
          remaining={queue.length - 1}
          refreshing={matchesQuery.isFetching}
          onRefresh={refresh}
          chatId={chatId}
          requested={sent?.state === 'sent'}
          helloCapped={helloCapped}
          onNext={() => {
            haptics.selection();
            // Name first: after passed.add the candidate leaves the queue,
            // and the bar has to say who it was about.
            const name = current.match.display_name ?? 'them';
            passed.add(current.userId);
            setRestoredId(null);
            if (undoTimer.current) {
              clearTimeout(undoTimer.current);
            }
            setUndo({ id: current.userId, name });
            undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
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
                : // Still the trip, not the bio: both people are there by
                  // definition of the match even when formatDateRange has no
                  // computed overlap to quote — and a bio anchor claimed a
                  // hello came from a field that may be empty.
                  { key: 'trip', label: 'your dates together' },
            });
          }}
        />
      </Animated.View>
      {undo ? (
        // A sibling of the deck, not a child of TravelerPage, so it survives
        // the key={current.userId} remount when the next face slides in. It
        // floats over a scrolling page, so it carries its own opaque surface
        // (the exact defect the action bar's plate exists to fix), and it
        // deliberately does not grow the scroll padding: a 5-second bar that
        // reflows the page mid-read is worse than one floating above it.
        <Animated.View
          entering={FadeInDown.duration(Motion.standard)}
          exiting={FadeOutDown.duration(Motion.quick)}
          style={[styles.undoDock, { bottom: actionBarHeight(insets.bottom) }]}
          pointerEvents="box-none">
          <ThemedView type="surface" style={[styles.undoCard, Elevation.floating]}>
            <ThemedText type="footnote" numberOfLines={1} style={styles.undoText}>
              {`Moved past ${undo.name}`}
            </ThemedText>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Undo"
              haptic="light"
              scaleTo={0.96}
              onPress={undoPass}
              style={styles.undoButton}>
              <ThemedText type="smallBold" themeColor="accent">
                Undo
              </ThemedText>
            </PressableScale>
          </ThemedView>
        </Animated.View>
      ) : null}
    </ThemedView>
  );
}

/**
 * How long the undo bar stands. Long enough to read and reach, short enough
 * that it never becomes furniture; the next pass dismisses it early.
 */
const UNDO_MS = 5000;

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
  queueHeader: {
    alignItems: 'center',
    gap: Space.xs,
    paddingBottom: Space.md,
    // The row sat flush to both edges, so at larger Dynamic Type the centred
    // note ran under the absolutely-positioned ProfileCorner avatar.
    paddingHorizontal: Space.lg,
    paddingRight: HitTarget + Space.lg,
  },
  spotlightChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  sharedTodayNote: {
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
  nextButton: {
    // A pill with a word on it, not an unlabelled arrow floating in space:
    // the circle it replaces was surfaceSunken on canvas (1.15:1) outlined
    // in hairlineWidth hairline, with no visible word at all.
    height: ACTION_BUTTON,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    gap: Space.xs,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  undoDock: {
    position: 'absolute',
    left: Space.lg,
    right: Space.lg,
    alignItems: 'center',
    // Above the action bar's plate and ramp, which carry none.
    zIndex: 10,
  },
  undoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    maxWidth: MaxContentWidth,
    paddingLeft: Space.lg,
    paddingRight: Space.xs,
    borderRadius: Radius.pill,
  },
  undoText: {
    flexShrink: 1,
  },
  undoButton: {
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingHorizontal: Space.md,
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
  // Square per decision D2(a): 3:2 was the widest crop in the app, on the
  // screen whose whole job is proving there is a real person there. If the
  // square pushes the sign-up card too far down in the re-shot screenshots,
  // that finding reopens D2, not this line alone.
  cardHero: {
    aspectRatio: 1,
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
