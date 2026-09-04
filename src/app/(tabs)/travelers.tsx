import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
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
  DockedActionBar,
  dockedActionBarHeight,
} from '@/components/ui/docked-action-bar';
import { VerifiedSeal } from '@/components/ui/verified-seal';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Skeleton } from '@/components/ui/skeleton';
import { SignUpGate } from '@/components/ui/sign-up-gate';
import { useAuthStore } from '@/features/auth/store';
import { useBlockUser } from '@/features/chat/hooks';
import { guestEmptyCityLine, guestGateReason } from '@/features/guest/copy';
import {
  featuredPhotoFor,
  useFeaturedPhoto,
  useFeaturedTraveler,
  useIsGuest,
  useMapPins,
} from '@/features/guest/hooks';
import { useFeaturedCities } from '@/features/pins/hooks';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadError } from '@/components/ui/load-error';
import {
  Elevation,
  HitTarget,
  MaxContentWidth,
  Motion,
  Radius,
  Space,
  Spacing,
  Type,
} from '@/constants/theme';
import {
  useDailySpotlight,
  useFirstMessageBudget,
  useJustSentHello,
  useMatches,
  useMyChats,
  useSentRequests,
  useSetTravelersRadius,
} from '@/features/matching/hooks';
import { useSaidHi } from '@/features/matching/said-hi';
import { SentRequestCard } from '@/features/matching/sent-request-card';
import { usePassedTravelers } from '@/features/matching/passed';
import { useNextTravelersPrefetch } from '@/features/matching/prefetch';
import { sharedLanguages } from '@/features/matching/shared-language';
import { overlapSentence } from '@/features/matching/overlap';
import { remainingLine } from '@/features/matching/queue-copy';
import { sharedTodayNote } from '@/features/matching/spotlight';
import { openTravelerMenu } from '@/features/profile/actions-menu';
import { languageLabel } from '@/constants/languages';
import { AUDIENCE_LABEL, audienceInSentence } from '@/features/profile/audience';
import {
  useOwnProfile,
  useOwnUserId,
  useOwnVisibility,
  useProfilePriorities,
  useProfilePrompts,
  usePublicPhotos,
  usePublicProfile,
} from '@/features/profile/hooks';
import { DEFAULT_RADIUS_KM, RADIUS_OPTIONS_KM, radiusChipLabel } from '@/features/matching/radius';
import { RadiusSheet } from '@/features/matching/radius-sheet';
import { useAnnounce } from '@/features/chat/use-announce';
import { openReply } from '@/features/matching/respond';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { formatDate, formatTripDates, roughWhen, toISODate } from '@/features/trips/dates';
import { queueScope } from '@/features/matching/queue-scope';
import { TripPicker } from '@/features/matching/trip-picker';
import { effectiveSelection, useTripSelection } from '@/features/matching/trip-selection';
import { useMyTrips, useTravelerTrips } from '@/features/trips/hooks';
import {
  profileTripFromMatchRow,
  profileTripFromTravelerRow,
} from '@/features/trips/profile-trips';
import { useTabBarInset, useTabDockBottom } from '@/hooks/use-tab-bar-inset';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
import { haptics } from '@/lib/haptics';
import { splitDemoMarker } from '@/lib/demo-marker';
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
 * What a signed-out visitor sees: the travelers people are connecting with
 * most in this city right now, then the gate. Seeing real people is the whole
 * pitch — the account comes after that lands (docs/DESIGN.md).
 *
 * THREE FACES, NOT ONE, and the extra two are deliberately smaller. One face
 * cannot answer "are there people here on my dates", which is the question
 * this tab exists to answer on launch day, and a dead city is the category's
 * number one killer. But three full cards is exactly what the compact card
 * was introduced to prevent: the hero is a square (decision D2(a)) and a
 * stack of three plus a sign-up card is taller than any phone, which puts the
 * one thing this screen is asking somebody to do below the fold. So the lead
 * keeps the whole card and the other two are a face, a name and their dates.
 * More faces, less per face — the extra rows carry strictly nothing the lead
 * card does not, and a tap on any of them still brings the gate to them.
 */
function GuestTravelers() {
  const insets = useSafeAreaInsets();
  const intentRemembered = useAuthStore((s) => s.intentRemembered);
  // Dynamic Type grows the native tab bar; the constant it replaces did not.
  const tabBarInset = useTabBarInset();
  // The first city on the rail: the busiest, or the first launch city on
  // a quiet day. A guest has typed nothing, so the rail decides.
  const featuredQuery = useFeaturedCities();
  const featured = featuredQuery.data ?? [];
  const cityId = featured[0]?.city_id ?? null;
  const cityName = featured[0]?.cities?.name ?? null;
  const featuredTravelerQuery = useFeaturedTraveler(cityId);
  const { isPending } = featuredTravelerQuery;
  // `?? []` and not a default in the destructure: the query answers null while
  // it is disabled, and every branch below counts this list.
  const faces = featuredTravelerQuery.data ?? [];
  // The one who gets the whole card, and the ones who get a row.
  const lead = faces[0] ?? null;
  const alsoHere = faces.slice(1);
  // Evidence for the empty branch: the same faceless rows the guest map
  // already serves, counted. Never individual pins — a real traveler's venue
  // plus date is not guest content.
  const { data: cityPins = [] } = useMapPins(cityId);
  // Not usePhotoUrl: that signs the path with the caller's own credentials,
  // and a guest has none the storage layer will accept. See useFeaturedPhoto.
  // BY IDENTITY, not by position. The cards and the faces are two separate
  // calls to featured_traveler(), whose guards run per person, so the two row
  // sets can differ by somebody who was banned, blocked, narrowed their
  // audience or reached the end of their trip in between. Indexed, that draws
  // a real traveler's face under another real traveler's name on a signed-out
  // device; keyed, it draws a monogram.
  const photos = useFeaturedPhoto(cityId, faces).data;
  const photoUrl = lead ? featuredPhotoFor(photos, lead.user_id, 0) : null;
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  // "[demo]" out of the prose, onto a chip. See lib/demo-marker.
  const featuredBio = splitDemoMarker(lead?.bio);

  // No capture here: the parent screen fires travelers_viewed exactly once,
  // carrying the guest flag, for both audiences. This component used to fire
  // its own copy, so every guest counted twice and the parent's untagged
  // event made `guest != true` filters keep them.

  // A blank screen, forever, whenever the city list did not load: cityId
  // stayed null, so the featured query never enabled, so isPending never
  // cleared. The one screen a first-time visitor is most likely to open, and
  // it had nothing on it and nothing to say.
  if (featuredQuery.isError || featuredTravelerQuery.isError) {
    return (
      <ThemedView style={styles.root}>
        <ProfileCorner />
        <LoadError
          what="travelers"
          error={featuredQuery.error ?? featuredTravelerQuery.error}
          onRetry={() => {
            featuredQuery.refetch();
            featuredTravelerQuery.refetch();
          }}
        />
      </ThemedView>
    );
  }

  if (isPending || featuredQuery.isPending) {
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
          { paddingTop: insets.top + Space.lg, paddingBottom: tabBarInset + Space.xxl },
        ]}>
        <ThemedText type="display">Travelers</ThemedText>
        {lead ? (
          <>
            {/* Say which one it is. featured_traveler's window is "in town
                within the next two weeks", so a flat "right now" was a claim
                the query does not make: the founder's own test profile showed
                up under it with a trip starting five days later. */}
            <ThemedText type="footnote" themeColor="textSecondary">
              {/* A rough window never gets a day. "In Lisbon from Sep 3" is
                  one specific date stated as a fact, to a SIGNED-OUT device,
                  about somebody who only ever said a month - and unlike the
                  trip card there is no prefix that repairs it, because the
                  sentence is built around an arrival day. Drop to the scale
                  the traveler actually picked instead. */}
              {lead.approximate
                ? `In ${lead.city_name} sometime ${roughWhen(lead.their_start, lead.their_end)}`
                : lead.their_start > toISODate(new Date())
                  ? `In ${lead.city_name} from ${formatDate(lead.their_start)}`
                  : `In ${lead.city_name} this week`}
            </ThemedText>
            {/* Compact on purpose. This is a teaser with a sign-up card
                under it, and a full-height photo pushed that card off the
                bottom of the screen — where a guest never saw the one thing
                the screen is asking them to do. A guest's feed also arrives
                without photo paths, so the placeholder is the common case
                here, not the rare one. */}
            <PressableScale
              accessibilityRole="button"
              // What the tap DOES, which is bring the sign-up card into view.
              // It said "Say hi to Mara" and scrolled to a form, so the one
              // person who cannot see where the page went was told the wrong
              // thing about it - the same defect the visible line below this
              // card was rewritten to fix, left on the label.
              accessibilityLabel={`${lead.display_name ?? 'This traveler'}. Make a profile to see theirs`}
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
                          {lead.display_name ?? 'Traveler'}
                          {lead.age != null ? `, ${lead.age}` : ''}
                        </Text>
                        {lead.verified ? (
                          <VerifiedSeal name={lead.display_name} age={lead.age} onPhoto />
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
                          {(lead.display_name ?? 'T').trim().charAt(0).toUpperCase()}
                        </ThemedText>
                      </View>
                      <ThemedText type="headline" numberOfLines={1} style={styles.nameText}>
                        {lead.display_name ?? 'Traveler'}
                        {lead.age != null ? `, ${lead.age}` : ''}
                      </ThemedText>
                      {lead.verified ? (
                        <VerifiedSeal name={lead.display_name} age={lead.age} />
                      ) : null}
                    </View>
                  )}
                  <ThemedText type="footnote" themeColor="textSecondary">
                    {lead.city_name} ·{' '}
                    {formatTripDates(lead.their_start, lead.their_end, lead.approximate)}
                  </ThemedText>
                  {/* The seeded bios end in a literal "[demo]" (the fixture
                      requires a visible marker: AI portraits, no real
                      likeness). A bracketed token as the last line of prose
                      reads as unfinished software, so the marker becomes a
                      chip — which survives truncation — and the prose is
                      shown clean. */}
                  {featuredBio.isDemo ? (
                    <View style={[styles.demoChip, { backgroundColor: theme.surfaceSunken }]}>
                      <ThemedText type="caption" themeColor="textSecondary">
                        Sample profile
                      </ThemedText>
                    </View>
                  ) : null}
                  {featuredBio.bio ? <ThemedText type="body">{featuredBio.bio}</ThemedText> : null}
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
            {alsoHere.length > 0 ? (
              <>
                {/* Frames the rows as more of the same city rather than a
                    list with no heading, and it has to do it WITHOUT saying
                    anybody is there. featured_traveler's window is
                    `start_date <= current_date + 14`, so "Also in Lisbon" was
                    a present-tense locative over people who may be nine days
                    from arriving — the same claim the lead line above was
                    rewritten to drop, made again at group level and on a
                    signed-out device. "Plans" is the word the map already
                    uses for future intent, and it covers a traveler who is
                    there today as well as one who lands next week. The
                    per-row dates say which. */}
                <ThemedText type="footnote" themeColor="textSecondary">
                  {/* Counted, because featured_traveler answers with up to
                      three and two of those leave exactly one row under this
                      line. */}
                  {alsoHere.length === 1
                    ? `One more traveler with ${lead.city_name} plans`
                    : `More travelers with ${lead.city_name} plans`}
                </ThemedText>
                {alsoHere.map((traveler, index) => {
                  // By this traveler's own id. The +1 is the fallback index
                  // for a bundle talking to an edge function that predates
                  // identities: this map starts at the second person, so row n
                  // here is row n+1 of the list the URLs were minted for.
                  const rowPhoto = featuredPhotoFor(photos, traveler.user_id, index + 1);
                  return (
                    <PressableScale
                      key={traveler.user_id}
                      accessibilityRole="button"
                      // Same destination, same sentence as the lead card.
                      accessibilityLabel={`${traveler.display_name ?? 'This traveler'}. Make a profile to see theirs`}
                      scaleTo={0.98}
                      haptic="none"
                      // Same destination as the lead card, for the same reason:
                      // the profile route is unreadable signed-out, so a push
                      // would be a tap that silently does nothing.
                      onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}>
                      <ThemedView type="backgroundElement" style={styles.card}>
                        <View style={[styles.cardBody, styles.alsoRow]}>
                          {/* No face is an ordinary answer here — a traveler
                            with no approved photo, or one the two calls
                            disagreed about — and the monogram covers it. */}
                          {rowPhoto ? (
                            <Image
                              source={{ uri: rowPhoto }}
                              style={styles.alsoPhoto}
                              contentFit="cover"
                              contentPosition="top"
                            />
                          ) : (
                            <View style={[styles.cardMono, { backgroundColor: theme.accentSoft }]}>
                              <ThemedText type="title" style={{ color: theme.accent }}>
                                {(traveler.display_name ?? 'T').trim().charAt(0).toUpperCase()}
                              </ThemedText>
                            </View>
                          )}
                          <View style={styles.alsoText}>
                            <View style={styles.nameRow}>
                              <ThemedText type="headline" numberOfLines={1} style={styles.nameText}>
                                {traveler.display_name ?? 'Traveler'}
                                {traveler.age != null ? `, ${traveler.age}` : ''}
                              </ThemedText>
                              {traveler.verified ? (
                                <VerifiedSeal name={traveler.display_name} age={traveler.age} />
                              ) : null}
                            </View>
                            {/* Dates and nothing else. Three faces is the whole
                              change; three bios would be three times as much of
                              three real travelers on a device with no account.
                              20260902260000 stopped sending them as well, so
                              this row has nothing to print even if it tried. */}
                            <ThemedText type="footnote" themeColor="textSecondary">
                              {formatTripDates(
                                traveler.their_start,
                                traveler.their_end,
                                traveler.approximate
                              )}
                            </ThemedText>
                          </View>
                        </View>
                      </ThemedView>
                    </PressableScale>
                  );
                })}
              </>
            ) : null}
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
          reason={guestGateReason(lead?.display_name, lead != null, cityName)}
          // Not the reason: that sentence carries a real traveler's name.
          where="travelers-tab"
          // The third origin the account wall used to throw away: signup
          // lands this person back on the Travelers tab (the tabs layout
          // replays it). Recorded only on the tap through.
          onNavigate={(go) => {
            if (cityId != null) {
              intentRemembered({
                kind: 'traveler',
                cityId,
                ...(lead != null ? { userId: lead.user_id } : {}),
              });
            }
            go();
          }}
        />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * The fixed band above the page: the trip rail, the spotlight note, the
 * scope line and the radius dial. Its own component, rendered ONCE above the
 * keyed page rather than inside it: the page remounts on every Next (its
 * key is the person), and a header inside it tore down the rail's scroll
 * position and faded in again on every pass. A person scrolled to a
 * November chip in a year of trips stays there while they read.
 */
function QueueHeader({
  tripPicker,
  isSpotlight,
  spotlightName,
  countLine,
  radiusKm,
  onOpenRadius,
}: {
  /** The trip chips, built by the screen: which of the reader's trips the queue is for. */
  tripPicker: React.ReactNode;
  /**
   * True when the person on screen is today's mutual spotlight. The note is
   * built here rather than passed in, because it names the traveler and a
   * prepared string let the old ceremony line ("You're top of their list
   * too.") sit where nothing about it looked like copy.
   */
  isSpotlight: boolean;
  spotlightName: string | null;
  /** The scope line under the picker: how many more, and for which trips. */
  countLine: string;
  /** How far from each trip city the queue reaches, so the header can say so. */
  radiusKm: number;
  onOpenRadius: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <>
      {/* A fixed header, outside the scroller, so the scope of the queue is
          readable on every traveler and does not scroll away with the page.
          Headroom for the notch: this screen has no navigation header, so
          without the inset the first line starts at y=0 under the status
          bar. */}
      <View style={[styles.queueHeader, { paddingTop: insets.top + Space.sm }]}>
        {tripPicker}
        {isSpotlight ? (
          // States the mechanism, not a ranking. daily_spotlights is a
          // canonically ordered pair with one row per person per day, so
          // "shown to you and them" is exactly what the table guarantees.
          // The line it replaced ("You're top of their list too.") claimed
          // a named stranger had ranked the reader, which is the
          // reciprocal-interest reveal the product exists to avoid. The
          // "Today in <city>" chip that used to sit above it is gone (the
          // founder put the trip picker where it was); its sparkles stay
          // beside the sentence so the spotlight still reads as the one
          // different person on the page.
          <View style={styles.spotlightRow}>
            <SymbolView
              name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
              size={13}
              tintColor={theme.accent}
              accessibilityElementsHidden
            />
            <ThemedText type="footnote" themeColor="textSecondary" style={styles.sharedTodayNote}>
              {sharedTodayNote(spotlightName)}
            </ThemedText>
          </View>
        ) : null}
        {/* The scope of the queue, not of the city: this count is already
            filtered by passes, chats, hellos sent and the viewer's own
            audience setting, and the words are careful to claim no more.
            The city is named only when the queue is for one city: with
            several trips in view it used to borrow whoever was on screen. */}
        <ThemedText type="footnote" themeColor="textSecondary" style={styles.sharedTodayNote}>
          {countLine}
        </ThemedText>
        {/* THE DIAL, where the scope is read. The queue reaches this far
            from each of the reader's own trip cities; a person in Nice
            deciding whether Cannes counts decides it here, on the screen
            that shows them the answer, not in a settings page. */}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${radiusChipLabel(radiusKm)}. Changes how far Travelers looks.`}
          testID="travelers-radius"
          hitSlop={4}
          haptic="selection"
          scaleTo={0.94}
          onPress={onOpenRadius}>
          <View
            style={[
              styles.radiusChip,
              { backgroundColor: theme.surface, borderColor: theme.border },
            ]}>
            <SymbolView
              name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
              size={12}
              tintColor={theme.textSecondary}
            />
            <ThemedText type="caption" themeColor="textSecondary">
              {radiusChipLabel(radiusKm)}
            </ThemedText>
          </View>
        </PressableScale>
      </View>
    </>
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
  barHeight,
  onBarHeight,
  onSayHi,
  onNext,
  onMore,
  helloCapped,
  refreshing,
  onRefresh,
}: {
  candidate: Candidate;
  width: number;
  /**
   * The action bar's height, measured by the bar itself and held by the
   * parent (the undo bar floats on the same number). Seeded from the
   * formula so the first frame is right; the measurement corrects it.
   */
  barHeight: number;
  onBarHeight: (height: number) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onSayHi: () => void;
  onNext: () => void;
  /** Report, block, or open the full profile of the person on screen. */
  onMore: () => void;
  /** No hellos left today — the Say hi button says so instead of opening. */
  helloCapped: boolean;
}) {
  const theme = useTheme();
  // The dock clearance tracks Dynamic Type with the tab bar it stands on.
  const dockBottom = useTabDockBottom();
  const { data: profile } = usePublicProfile(candidate.userId);
  const { data: photos = [] } = usePublicPhotos(candidate.userId);
  const { data: trips = [] } = useTravelerTrips(candidate.userId);
  const { data: prompts = [] } = useProfilePrompts(candidate.userId);
  const { data: priorities = [] } = useProfilePriorities(candidate.userId);
  // The READER'S own prompts, for the nudge below. Travelers is the reading
  // surface the design brief gives to "one person, full page", so it is where
  // most people meet somebody else's answers; wiring the nudge only to
  // /profile/[userId] (reached from a chat header or a pin card) meant most
  // readers would never see it. Gated on isSuccess, never on the defaulted
  // empty array, so it cannot flash at somebody who has answered them all.
  const ownUserId = useAuthStore((st) => st.session?.user.id ?? null);
  const ownPromptsQuery = useProfilePrompts(ownUserId);

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
    // Somebody else's dial is not this page's business; the type wants a
    // number and the default is the honest placeholder.
    travelers_radius_km: DEFAULT_RADIUS_KM,
    onboarding_completed_at: null,
    created_at: '',
    updated_at: '',
  };
  const shown = profile ?? fallback;
  const name = shown.display_name ?? 'this traveler';
  // The second-heaviest term in the match score, said out loud instead of
  // spent entirely on ordering. Never when English is the only thing shared:
  // that is most pairs, and a line on most cards is a line nobody reads.
  const { data: mine } = useOwnProfile();
  const shared = sharedLanguages(mine?.languages, candidate.match.languages);
  const alsoSpeaks = shared[0] ? `Also speaks ${languageLabel(shared[0])}` : null;
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
              moderation_category: null,
              moderation_engine: null,
              created_at: '',
            },
          ]
        : [];

  const profileTrips: ProfileTrip[] = (
    trips.length > 0
      ? trips.map(profileTripFromTravelerRow)
      : // The placeholder shown for the beat before traveler_trips answers.
        // Written out here until now, which made features/trips/profile-trips
        // four of five rather than the single place a new column reaches.
        [profileTripFromMatchRow(candidate.match)]
  ).map((trip) => ({ ...trip, overlap: candidate.overlaps.get(trip.id) ?? null }));

  return (
    <View style={[styles.page, { width }]}>
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
          // from the bar's MEASURED height so it cannot silently go short
          // the moment the bar grows — at the accessibility sizes the
          // buttons outgrow any formula. The magic 148 this replaces was
          // double-counting the tab inset (198 of padding for a 135pt bar).
          paddingBottom: barHeight + Space.xl,
        }}
        showsVerticalScrollIndicator={false}>
        <ProfileView
          profile={shown}
          alsoSpeaks={alsoSpeaks}
          photos={shownPhotos}
          prompts={prompts}
          priorities={priorities}
          trips={profileTrips}
          handles={[]}
          owner={false}
          onAnswerYourOwnPrompt={
            ownUserId != null && ownPromptsQuery.isSuccess && ownPromptsQuery.data.length === 0
              ? () => router.push('/edit-prompt')
              : undefined
          }
          // Always open. The queue filter drops everybody already written to
          // and everybody already in a chat BEFORE a card is chosen, so the
          // three states this used to branch on could not reach the screen:
          // the file described behaviour it was unable to produce.
          onRespondTo={(target) =>
            openReply({
              userId: candidate.userId,
              name: shown.display_name ?? 'Traveler',
              photoPath: candidate.match.photo_path ?? null,
              target,
              // This tab only ever shows people whose trip overlaps yours,
              // which is exactly what the trip_match check wants.
              source: 'trip_match',
              // And the beat afterwards belongs here.
              origin: 'travelers',
            })
          }
        />
      </ScrollView>

      {/* The floating action bar, extracted to components/ui/docked-action-bar
          so the map's pin-reached profile docks the same chrome. The plate,
          the ramp, and the hit-testing rules all live there now. */}
      <DockedActionBar
        bottomInset={dockBottom}
        onBarHeight={onBarHeight}
        // Two states, and both are reachable. PrimaryButton renders disabled
        // as a surfaceSunken fill with a textSecondary label (8.2:1), not a
        // fade, so "No first messages left today" stays legible while it
        // says not-now.
        primaryLabel={helloCapped ? 'No first messages left today' : 'Say hi'}
        disabled={helloCapped}
        onPrimary={onSayHi}
        secondary={
          <>
            {/* Safety, on the screen where a stranger is first read.
                Travelers is where somebody spends the most time with one
                stranger at a time, and it carried no report and no block at
                all: to report the man on screen you had to open his full
                profile and find the nav bar's overflow. Same sheet, same
                three items, one place they are written.

                The bottom row is the honest anchor because this card has no
                header — nothing sits above the photo but the spotlight
                strip. Narrow and shrink-proof on purpose: at the
                accessibility text sizes this row is Say hi, Next and this,
                and the primary is the one that must keep its words. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`More about ${name}`}
              haptic="light"
              scaleTo={0.94}
              onPress={onMore}
              style={[
                styles.moreButton,
                { backgroundColor: theme.surfaceSunken, borderColor: theme.border },
              ]}>
              <SymbolView
                name={{ ios: 'ellipsis', android: 'more_horiz', web: 'more_horiz' }}
                size={18}
                tintColor={theme.text}
              />
            </PressableScale>
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
              <ThemedText type="caption" themeColor="textSecondary">
                Next
              </ThemedText>
            </PressableScale>
          </>
        }
      />
    </View>
  );
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

/**
 * The beat after the highest-intent tap in the product.
 *
 * It used to end in a face swap nobody asked for: the composer's
 * confirmation popped, a different stranger had silently taken the page, and
 * there was no trace on Travelers that anything had been said.
 *
 * A beat, not a resting state. The next traveler is already underneath and
 * the strip floats over them, because the founder rejected a post-send
 * screen the reader gets stuck behind.
 *
 * No link to the conversation: a hello is a message_request behind the
 * accept gate and passes moderation before delivery, so there is no chat to
 * open yet and the link would be dead. Chat is where the record lives, and
 * that is what this says.
 *
 * A component rather than two copies of the block, because it has to render
 * on BOTH of this screen's branches: saying hi to the last candidate is
 * exactly what empties the queue, so the branch with no card left is the one
 * the confirmation matters most on. `bottom` is what differs — the main
 * branch has a measured action bar to sit above, the empty one has none, so
 * it stands on the formula instead.
 */
function SaidHiStrip({ name, bottom }: { name: string; bottom: number }) {
  const theme = useTheme();
  // The id of the message the sentence is about, read HERE rather than passed
  // in: both render sites below would otherwise have to carry a prop that is
  // the same store lookup twice, and the strip is the only thing that wants
  // it. Null on a stamp made by an older bundle, and then the bar simply does
  // not offer the action - withdrawing a first message matched by NAME could
  // take back the wrong one, and the anti-pester constraint makes that
  // unrecoverable.
  const requestId = useJustSentHello((s) => s.requestId);
  // Local, and only forward: the bar has one beat to live and the write it
  // reports cannot be undone, so there is nothing to reconcile with a refetch.
  const [takenBack, setTakenBack] = useState(false);
  // Said out loud, because the sentence changing under a button that has just
  // vanished is invisible to VoiceOver: `accessibilityLiveRegion` is
  // Android-only in React Native, so this is the mechanism and not a fallback.
  useAnnounce(takenBack ? 'Taken back' : null);
  return (
    <Animated.View
      entering={FadeInDown.duration(Motion.standard)}
      exiting={FadeOutDown.duration(Motion.quick)}
      style={[styles.undoDock, { bottom }]}
      pointerEvents="box-none">
      <ThemedView type="surface" style={[styles.undoCard, Elevation.floating]}>
        {takenBack ? (
          // The control said "Take it back" and the confirmation says those
          // words back. Nothing about the other person: whether they had seen
          // it is not something this app knows or may imply.
          <ThemedText type="footnote" style={styles.undoText}>
            Taken back.
          </ThemedText>
        ) : (
          <>
            {/* No accessibilityLabel on the press: on iOS a labelled Pressable
                becomes one element and hides the words inside it, and these
                words are the whole point of the bar. */}
            <PressableScale
              accessibilityRole="button"
              accessibilityHint="Opens your chats"
              haptic="light"
              scaleTo={0.99}
              onPress={() => {
                useSaidHi.getState().clear();
                // navigate, not push: pushing a tab route from inside the tabs
                // stacks a second copy of the navigator.
                router.navigate('/chat');
              }}
              style={styles.saidHiText}>
              <ThemedText type="footnote" numberOfLines={2}>
                {`Said hi to ${name}. It's in Chat under "You said hi".`}
              </ThemedText>
            </PressableScale>
            {requestId ? (
              <SentRequestCard requestId={requestId} onTakenBack={() => setTakenBack(true)} />
            ) : null}
          </>
        )}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          haptic="light"
          scaleTo={0.96}
          onPress={() => useSaidHi.getState().clear()}
          style={styles.undoButton}>
          <SymbolView
            name={{ ios: 'xmark', android: 'close', web: 'close' }}
            size={13}
            tintColor={theme.textSecondary}
          />
        </PressableScale>
      </ThemedView>
    </Animated.View>
  );
}

export default function TravelersScreen() {
  const insets = useSafeAreaInsets();
  const dockBottom = useTabDockBottom();
  // The action bar's real height, measured by the bar and held HERE because
  // the undo bar floats on the same number. Seeded from the formula so the
  // first frame is right; the measurement only corrects it.
  const [barHeight, setBarHeight] = useState(() => dockedActionBarHeight(dockBottom));
  const { width } = useWindowDimensions();
  const isGuest = useIsGuest();
  const tripsQuery = useMyTrips();
  const trips = tripsQuery.data ?? [];
  // WHICH TRIPS THE QUEUE IS FOR. A person with several trips planned picks
  // the ones they are looking at (features/matching/trip-selection); the
  // server narrows the queue to those, so somebody who overlaps them in
  // Lisbon is not lost to a queue attributed to Nice. A view preference
  // only: it changes nothing about who can see them. `effectiveSelection`
  // drops ids of trips that ended or were deleted and reads a full set as
  // every trip, so the query key and the chips agree about what "all" is.
  const ownUserId = useOwnUserId();
  const tripSelection = useTripSelection(ownUserId);
  const tripIds = trips.map((trip) => trip.id);
  const selectedTrips = effectiveSelection(tripSelection.selected, tripIds);
  // Not until the stored choice AND the trips are read: with either
  // missing the selection resolves to every trip, and fetching that first
  // and the chosen trips a beat later would flash the wrong queue on every
  // open. The focus refetch below waits on the same flag.
  const queueReady = tripSelection.hydrated && tripsQuery.data != null;
  const matchesQuery = useMatches(selectedTrips, queueReady);
  const matches = matchesQuery.data ?? [];
  // The trips the queue is for, and the one city to name when there is
  // exactly one: several trips in view have no honest city to put in a
  // sentence, and the line used to borrow whoever was on screen.
  const tripsInView =
    selectedTrips == null ? trips : trips.filter((trip) => selectedTrips.includes(trip.id));
  const citiesInView = Array.from(new Set(tripsInView.map((trip) => trip.cities.name)));
  const narrowed = selectedTrips != null;
  // One phrase for what the queue is for, shared by the count line, the
  // wall's title and the settle VoiceOver hears, so they cannot disagree.
  const scope = queueScope(citiesInView, tripsInView.length, narrowed);
  // A chip tap keeps the old queue on screen while the new one loads; the
  // count line says so rather than counting the wrong trips for a beat.
  const checking = matchesQuery.isFetching && matchesQuery.isPlaceholderData;
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
  const [undo, setUndo] = useState<{ id: string; name: string; at: number } | null>(null);
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
  // Who the composer just wrote to. There is no other way to know: the
  // composer is a modal on its own route, `router.back()` carries nothing,
  // and the recipient has already been filtered out of the queue by the time
  // this screen re-renders. See features/matching/said-hi.
  const saidHiTo = useSaidHi((s) => s.sentTo);
  // Whether the stamp is still inside its beat, sampled by the effect that
  // owns the dismissal timer rather than read off the clock during render: a
  // Date.now() in a render body is impure, and its answer would only change
  // when the component happened to re-render anyway. It starts false, which
  // is what makes a stale stamp unpaintable rather than merely short-lived.
  const [saidHiFresh, setSaidHiFresh] = useState(false);
  // Focus, not a plain effect: the composer's own confirmation is still up
  // for a beat after the send, and a timer started under it spends most of
  // itself behind a modal. This one starts when the strip is actually on
  // screen, and it spends what is LEFT of the beat when the tab is come back
  // to, so a strip half-read before a tab switch finishes rather than
  // starting over.
  useFocusEffect(
    useCallback(() => {
      if (!saidHiTo) {
        setSaidHiFresh(false);
        return;
      }
      const left = SAID_HI_MS - (Date.now() - saidHiTo.at);
      if (left <= 0) {
        // A stamp that was never counted down, because this timer only runs
        // while the tab is on screen. Saying hi from the map and opening
        // Travelers an hour later used to paint a confirmation of something
        // long finished; it is dropped here instead, before it can show.
        setSaidHiFresh(false);
        useSaidHi.getState().clear();
        return;
      }
      setSaidHiFresh(true);
      const timer = setTimeout(() => useSaidHi.getState().clear(), left);
      return () => clearTimeout(timer);
    }, [saidHiTo])
  );
  // Derived HERE, above every early return, and rendered in both branches
  // below. Saying hi to the last candidate is precisely what empties the
  // queue — the send invalidates sent-requests, sentByRecipient drops them,
  // and queue.length hits 0 — so a strip that only existed under the main
  // return was missing from the one case it matters most in.
  const showSaidHi =
    saidHiTo != null &&
    // Only this tab's own hellos. useSendRequest is the app's ONLY send
    // path: the map's pin card and a stranger's profile go through it too,
    // and nothing but this screen ever clears the store. Unfiltered, a
    // hello sent from the map an hour ago painted a strip here claiming it
    // had just happened.
    saidHiTo.origin === 'travelers' &&
    // And only while it is still that beat, which the effect above decides
    // rather than the render: the strip starts false, so a stale stamp
    // cannot paint even for the frame before that effect runs.
    saidHiFresh &&
    // One transient bar at a time, and the newer act owns the slot: both
    // float on the same number above the action bar, so one landing on top
    // of the other is the whole failure mode. A comparison in render cannot
    // get out of step the way two effects cancelling each other would.
    (undo == null || saidHiTo.at >= undo.at);
  // Above every early return, so hook order stays stable. This screen used
  // to have no idea the setting existed, which is why an empty queue said
  // "that's everyone" whatever the reason.
  const { data: audience = 'everyone' } = useOwnVisibility();
  // Blocking from the card. Declared with the other hooks, above every early
  // return, so hook order stays stable.
  const block = useBlockUser();
  // How far the queue reaches from each of my trip cities: read off the
  // profile, changed through useSetTravelersRadius (features/matching/hooks),
  // which also refetches the queue and the inbox chips.
  const { data: ownProfile } = useOwnProfile();
  const radiusKm = ownProfile?.travelers_radius_km ?? DEFAULT_RADIUS_KM;
  const [radiusOpen, setRadiusOpen] = useState(false);
  const radius = useSetTravelersRadius();
  const radiusSheet = radiusOpen ? (
    <RadiusSheet
      value={radiusKm}
      saving={radius.isPending}
      onChange={radius.set}
      onClose={() => setRadiusOpen(false)}
    />
  ) : null;
  const canLookFurther = radiusKm < RADIUS_OPTIONS_KM[RADIUS_OPTIONS_KM.length - 1];

  // Destructured because a query RESULT is a new object every render while
  // its refetch is stable — same pattern as chat.tsx, for the same reason.
  const { refetch: refetchTrips } = tripsQuery;
  const { refetch: refetchMatches } = matchesQuery;
  const refresh = useCallback(() => {
    refetchTrips();
    // refetch() ignores `enabled`, so before the selection is read this
    // would fire the every-trip query the flag above exists to hold back.
    if (queueReady) {
      refetchMatches();
    }
  }, [refetchTrips, refetchMatches, queueReady]);
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

  // The next two faces, downloaded before the card turns. Above the early
  // returns with every other hook; the queue it reads is already computed.
  useNextTravelersPrefetch(
    queue.map((candidate) => ({
      userId: candidate.userId,
      photoPath: candidate.match.photo_path ?? null,
    }))
  );

  // Say the settle out loud. VoiceOver heard silence while this screen
  // loaded and silence when it resolved, so empty and loaded were
  // indistinguishable without re-exploring by hand. The queue above is
  // computed before the early returns exactly so this hook can sit with the
  // other hooks; failures are announced by LoadError itself.
  useAnnounce(
    !isGuest &&
      tripsQuery.isSuccess &&
      matchesQuery.isSuccess &&
      // A chip tap keeps the old queue on screen as placeholder data while
      // the new one loads; saying nothing until it lands is what makes the
      // settle audible again after every tap.
      !(matchesQuery.isFetching && matchesQuery.isPlaceholderData)
      ? trips.length === 0
        ? 'Travelers opens once you add a trip'
        : queue.length === 0
          ? // The same branch the visible wall takes: when the viewer's own
            // audience setting is what emptied the queue, "nobody new" is a
            // supply claim the founder already flagged as reading like a
            // broken filter. Say what the wall says.
            audience !== 'everyone'
            ? 'Nobody fits who you asked to see. It works both ways.'
            : `Nobody new on your dates ${scope.where} right now`
          : `${countOf(queue.length, 'traveler')} ${scope.where}`
      : null
  );

  // THE TRIP PICKER, shown with two or more trips: with one there is nothing
  // to choose. A tap keeps whoever is on screen at the front of the new
  // queue when they are still in it (the same hoist Undo uses), so
  // narrowing to the city of the person you are reading does not turn the
  // card.
  const tripPicker =
    trips.length > 1 ? (
      <View style={styles.tripRail}>
        <TripPicker
          trips={trips}
          selected={selectedTrips}
          onToggle={(tripId) => {
            setRestoredId(queue[0]?.userId ?? null);
            tripSelection.toggle(tripId, tripIds);
          }}
          onAll={() => {
            setRestoredId(queue[0]?.userId ?? null);
            tripSelection.selectAll();
          }}
        />
      </View>
    ) : null;

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        configError
        icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
      />
    );
  }

  if (isGuest) {
    return <GuestTravelers />;
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
        {/* The same clearance as the other wall below: Space.xxl put a
            headline through ProfileCorner's lower half, so both walls clear
            the 44pt avatar the same way and start at the same y. */}
        <View style={[styles.empty, { paddingTop: insets.top + Space.sm + HitTarget + Space.lg }]}>
          {/* The second half of the sentence signup started. Step 10's skip
              says "Travelers stays closed until you do.", so the wall echoes
              those words instead of arriving as a surprise with no memory
              that the skip was a choice. The action goes straight to the
              fix: sending someone to their profile to hunt for the button is
              one hop of homework between a person and the thing this screen
              just told them they need. */}
          <EmptyState
            title="Travelers opens once you add a trip"
            body="You'll see who's in town on your dates."
            action={{ label: 'Add a trip', onPress: () => router.push('/add-trip') }}
          />
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
    // The cities in view, not every trip's: a wall for "just Lisbon" that
    // named Bangkok too would be describing a queue nobody asked for.
    const cityNames = citiesInView;
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
      : `That's everyone on your dates ${scope.where}`;
    // Narrowed to some trips: say the scope plainly and offer the way back,
    // because the person chose this and the wall is the choice's result.
    const oneInView = tripsInView.length === 1 ? tripsInView[0] : null;
    const narrowedNote = !narrowed
      ? null
      : oneInView
        ? oneInView.approximate
          ? `You're only looking at ${oneInView.cities.name}, sometime ${roughWhen(oneInView.start_date, oneInView.end_date)}.`
          : `You're only looking at ${oneInView.cities.name}, ${formatTripDates(oneInView.start_date, oneInView.end_date)}.`
        : `You're only looking at ${tripsInView.length} of your ${trips.length} trips.`;
    const body = filtered
      ? `You are set to ${audienceInSentence(audience)}. It works both ways, so this hides you from everyone else too.`
      : (narrowedNote ?? 'More show up every day.');
    // A chip tap from this wall fetches a new queue, and until it lands the
    // wall is the old one: "That's everyone in Lisbon" over a Lisbon queue
    // that has not been asked for yet is the one claim this screen must
    // never make. The header line says "Checking" for the same beat.
    const wallTitle = checking ? `Checking ${scope.noun}…` : headline;
    return (
      <ThemedView style={styles.root}>
        <ProfileCorner />
        <View style={styles.deck}>
          {/* The same band the queue's header stands in, rail and all, so
              the chip tap that empties the queue does not take the rail
              away with it: a person narrowed to a trip nobody overlaps used
              to land on a wall with no way back but a setting. Its minHeight
              is the avatar's row, so with one trip (no rail) the headline
              still clears the 44pt ProfileCorner exactly as the no-trips
              wall does; Space.xxl used to put its first line straight
              through the avatar's lower half. */}
          <View
            style={[
              styles.wallBand,
              { paddingTop: insets.top + Space.sm, minHeight: insets.top + Space.sm + HitTarget },
            ]}>
            {tripPicker}
          </View>
          <View style={styles.empty}>
            {/* navigate, not push: pushing '/(tabs)' from inside the tabs
              stacks a SECOND copy of the whole tab navigator on the root
              stack rather than switching to Map, so the way back was a
              gesture nobody would guess at. */}
            <EmptyState
              title={wallTitle}
              body={body}
              action={
                filtered
                  ? {
                      label: `Change who you see (${AUDIENCE_LABEL[audience]})`,
                      onPress: () => router.push('/visibility'),
                    }
                  : narrowed
                    ? { label: 'Show all trips', onPress: tripSelection.selectAll }
                    : { label: 'Drop a pin', onPress: () => router.navigate('/(tabs)') }
              }>
              {filtered ? (
                <PrimaryButton
                  variant="ghost"
                  label="Drop a pin"
                  onPress={() => router.navigate('/(tabs)')}
                />
              ) : null}
              {/* The way back from the trip choice on the audience wall too.
                Above, the primary is the setting, because that is what
                emptied the queue; but a person narrowed to one trip who had
                also chosen "verified only" was offered nothing about the
                trips, and the rail alone should not have to carry it. */}
              {filtered && narrowed ? (
                <PrimaryButton
                  variant="ghost"
                  label="Show all trips"
                  onPress={tripSelection.selectAll}
                />
              ) : null}
              {/* The supply action that costs nothing: the same trip, a wider
                circle. Cannes is 26 km from Nice, and "that's everyone in
                Nice" is a sentence about the dial as much as about Nice. */}
              {!filtered && canLookFurther ? (
                <PrimaryButton
                  variant="ghost"
                  label={`Look further than ${radiusChipLabel(radiusKm).toLowerCase()}`}
                  onPress={() => setRadiusOpen(true)}
                />
              ) : null}
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
                    // empties the deck-free list while the 5s window still
                    // runs, and reset() would re-render the main return with a
                    // bar for a pass this very tap already restored.
                    if (undoTimer.current) {
                      clearTimeout(undoTimer.current);
                      undoTimer.current = null;
                    }
                    setUndo(null);
                    passed.reset();
                  }}
                />
              ) : null}
            </EmptyState>
          </View>
        </View>
        {/* And the confirmation lands HERE too. Saying hi to the last
            candidate is what empties the queue, so this branch is the one
            the beat matters most on and it used to be the one branch with no
            beat at all. There is no action bar under this wall to measure,
            so the strip stands on the formula the bar would have used. */}
        {showSaidHi && saidHiTo ? (
          <SaidHiStrip name={saidHiTo.name} bottom={dockedActionBarHeight(dockBottom)} />
        ) : null}
        {radiusSheet}
      </ThemedView>
    );
  }

  // Out of hellos for today, which is the only reason the button ever stops
  // being "Say hi": everybody with a chat or an unanswered hello is already
  // out of the queue above.
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
      <View style={styles.deck}>
        <QueueHeader
          tripPicker={tripPicker}
          isSpotlight={current.userId === spotlightId}
          spotlightName={current.match.display_name}
          countLine={
            checking ? `Checking ${scope.noun}…` : remainingLine(queue.length - 1, scope.where)
          }
          radiusKm={radiusKm}
          onOpenRadius={() => setRadiusOpen(true)}
        />
        {/* Keyed on the person, so a new face fades in; the header above is
            not, so it stays put. */}
        <Animated.View entering={FadeIn.duration(200)} style={styles.page} key={current.userId}>
          <TravelerPage
            candidate={current}
            barHeight={barHeight}
            onBarHeight={setBarHeight}
            width={Math.min(width, MaxContentWidth)}
            refreshing={matchesQuery.isFetching}
            onRefresh={refresh}
            helloCapped={helloCapped}
            // The same three items the chat header and a stranger's profile
            // raise. The block confirmation is this screen's own, because what
            // it promises here is what a traveler is promised everywhere: gone
            // from the map and Travelers, no message, not told.
            onMore={() =>
              openTravelerMenu({
                userId: current.userId,
                context: 'travelers',
                onBlock: () =>
                  Alert.alert(
                    `Block ${current.match.display_name ?? 'this traveler'}?`,
                    "They're gone from the map and Travelers, and can't message you. They're not told.",
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Block',
                        style: 'destructive',
                        onPress: () => block.mutate(current.userId),
                      },
                    ]
                  ),
              })
            }
            onNext={() => {
              haptics.selection();
              // Name first: after passed.add the candidate leaves the queue,
              // and the bar has to say who it was about.
              const name = current.match.display_name ?? 'them';
              // The two bars share one slot, so the newer act owns it.
              useSaidHi.getState().clear();
              passed.add(current.userId);
              setRestoredId(null);
              if (undoTimer.current) {
                clearTimeout(undoTimer.current);
              }
              setUndo({ id: current.userId, name, at: Date.now() });
              undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
            }}
            onSayHi={() => {
              // Anchored even on the lazy path. Every hello now opens pointed
              // at something specific, and when nothing on the profile has been
              // tapped the something is the fact that put these two people in
              // front of each other: the dates they share. A first message
              // with an anchor is easier to write, easier for the recipient to
              // answer, and easier for moderation to read in context.
              const overlap = [...current.overlaps.values()][0];
              // The one builder, shared with the pill on this very card and
              // with the chip on the card the recipient answers it from.
              const quote = overlapSentence(
                current.match.city_name,
                overlap?.start,
                overlap?.end,
                current.match.my_city_name
              );
              openReply({
                userId: current.userId,
                name: current.match.display_name ?? 'Traveler',
                photoPath: current.match.photo_path ?? null,
                source: 'trip_match',
                origin: 'travelers',
                target: quote
                  ? { key: 'trip', label: 'your dates together', quote }
                  : // Still the trip, not the bio: both people are there by
                    // definition of the match even when there is no computed
                    // overlap to quote — and a bio anchor claimed a hello came
                    // from a field that may be empty.
                    { key: 'trip', label: 'your dates together' },
              });
            }}
          />
        </Animated.View>
      </View>
      {showSaidHi && saidHiTo ? <SaidHiStrip name={saidHiTo.name} bottom={barHeight} /> : null}
      {radiusSheet}
      {undo && !showSaidHi ? (
        // A sibling of the deck, not a child of TravelerPage, so it survives
        // the key={current.userId} remount when the next face slides in. It
        // floats over a scrolling page, so it carries its own opaque surface
        // (the exact defect the action bar's plate exists to fix), and it
        // deliberately does not grow the scroll padding: a 5-second bar that
        // reflows the page mid-read is worse than one floating above it.
        <Animated.View
          entering={FadeInDown.duration(Motion.standard)}
          exiting={FadeOutDown.duration(Motion.quick)}
          style={[styles.undoDock, { bottom: barHeight }]}
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

/**
 * How long the said-hi strip stands, in screen time. Shorter than the undo
 * bar because nothing is waiting on a decision: it is an acknowledgement,
 * and the next traveler is already underneath it.
 *
 * It now also carries "Take it back", which is an argument for the undo bar's
 * five seconds rather than four - four is a short window in which to read a
 * sentence and reach a button. Left at four deliberately: the number is
 * pinned by src/app/__tests__/travelers-said-hi.test.ts, which belongs to
 * another implementer this session, and the report asks for the call.
 */
const SAID_HI_MS = 4000;

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
  spotlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  // The rail shares the top band with the 44pt avatar: a minHeight (never a
  // height, which clips at the accessibility sizes) centres the chips on it.
  tripRail: {
    alignSelf: 'stretch',
    minHeight: HitTarget,
    justifyContent: 'center',
    paddingBottom: Space.xs,
  },
  // The wall's copy of the header band: the rail's edges match the queue's
  // (queueHeader's padding), so the chips do not shift when the queue
  // empties under a tap.
  wallBand: {
    alignSelf: 'stretch',
    paddingHorizontal: Space.lg,
    paddingRight: HitTarget + Space.lg,
  },
  sharedTodayNote: {
    textAlign: 'center',
  },
  radiusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingHorizontal: Space.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    // A visible border, like the Next pill's: a hairline on this ground is
    // a word floating in the page (travelers-action-bar.test.ts).
    borderWidth: 1,
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
  moreButton: {
    // Icon only, and never wider than it has to be. The row is Say hi
    // (flex: 1), Next, and this: at Dynamic Type XXL the primary needs every
    // point it can get, so this one does not grow with the text and does not
    // shrink below a 44pt target either.
    minHeight: ACTION_BUTTON,
    width: HitTarget,
    alignSelf: 'stretch',
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
  },
  nextButton: {
    // A pill with a word on it, not an unlabelled arrow floating in space:
    // the circle it replaces was surfaceSunken on canvas (1.15:1) outlined
    // in hairlineWidth hairline, with no visible word at all. minHeight and
    // stretch, never a fixed height: the pill tracks the Say hi button as
    // both grow with Dynamic Type, instead of shrinking away from it and
    // costing the row its baseline.
    minHeight: ACTION_BUTTON,
    alignSelf: 'stretch',
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
  saidHiText: {
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: HitTarget,
    paddingVertical: Space.xs,
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
  // The second and third faces. A row, not a card: the lead's square hero
  // plus a sign-up card already fills a 6.1 inch screen, and two more of
  // those would put the gate somewhere nobody scrolls to.
  alsoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  alsoPhoto: {
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
  },
  alsoText: {
    flex: 1,
    gap: 2,
  },
  demoChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Space.sm,
    paddingVertical: Space.xs,
    borderRadius: Radius.pill,
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
