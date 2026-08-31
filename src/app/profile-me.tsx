import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { BuildStamp } from '@/components/ui/build-stamp';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { heldPhotoNotice } from '@/constants/moderation';
import { BrandDeep, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { BUSINESS_RULE_SECTIONS, BUSINESS_ZERO_TOLERANCE } from '@/constants/policies';
import { signOut, signOutEverywhere } from '@/features/auth/api';
import { deleteAccount } from '@/features/profile/api';
import {
  useOwnUserId,
  useProfilePriorities,
  useProfilePrompts,
  useLatestVerification,
  useOwnPhotos,
  useOwnProfile,
  useOwnSocialHandles,
  useOwnVisibility,
} from '@/features/profile/hooks';
import { AudienceCard } from '@/features/profile/audience-picker';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { useOwnBusiness } from '@/features/business/hooks';
import { NotificationsRow } from '@/features/notifications/notifications-row';
import { GUEST_SWEEP_LINE } from '@/features/guest/copy';
import { useIsGuest, useIsGuestAccount } from '@/features/guest/hooks';
import { useMyTrips } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import { isSupabaseConfigured } from '@/lib/supabase';

/**
 * What somebody without a profile sees when they tap the header avatar.
 *
 * Two people land here now: a visitor with no session at all, and a named
 * guest who joined a chat from a link. The difference is one string and one
 * button, so it is one component - a second would be the same scroll view
 * twice with a different noun in it.
 */
function GuestProfile({ guestName }: { guestName: string | null }) {
  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ headerTitle: 'Your profile' }} />
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
        <ThemedText type="display" style={styles.guestText}>
          {/* Founder, 2026-08-28: "'you are [name] in here' for guests is
              weird wording. Just have it say '[name], you are in guest
              mode'." The old line was trying to say the name is only for
              this app; it read as if it were correcting you about who you
              are. */}
          {guestName ? `${guestName}, you are in guest mode` : 'Browsing as a guest'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.guestText}>
          {/* Verb-led, parallel with the anonymous line below it. The old
              sentence ("A profile adds pins, trips and meeting people")
              broke its own list halfway through. */}
          {guestName
            ? 'Chats only for now. With a profile you can drop pins, post trips and meet people, and your chats come with you.'
            : 'Say hi, drop pins, join the open chats. Takes a minute.'}
        </ThemedText>
        {guestName ? (
          <ThemedText themeColor="textSecondary" style={styles.guestText}>
            {GUEST_SWEEP_LINE}
          </ThemedText>
        ) : null}
        {/* The founder's "click your own icon to change your name": the
            avatar in every header lands here, so this is that icon. */}
        {guestName ? (
          <PrimaryButton
            variant="ghost"
            label="Change my name"
            onPress={() => router.push('/guest-name')}
          />
        ) : null}
        <PrimaryButton label="Make my profile" onPress={() => router.push('/join')} />
        {/* The sign-in door renders for BOTH kinds of guest. It used to be
            hidden from a named guest — exactly the person most likely to
            remember mid-flow that their real account holds their trips and
            chats — who was offered only making a second one. */}
        {guestName ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.guestText}>
            Signing in leaves this guest name behind. Making a profile brings your chats with you.
          </ThemedText>
        ) : null}
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
        <PrimaryButton variant="ghost" label="Privacy" onPress={() => router.push('/privacy')} />
      </ScrollView>
    </ThemedView>
  );
}

/**
 * The account page a PLACE gets when it taps the header avatar.
 *
 * Not the traveler profile. That page offers Edit profile, Get verified (the
 * selfie flow), and Who you see and who sees you — three routes registered
 * only under the onboarded guard, which a business account never satisfies,
 * so all three did nothing at all. It also offered "Run a business?" to
 * somebody who runs one.
 *
 * Everything a business actually manages lives on the My business tab, so this
 * page is deliberately short: the way there, the rules a business is held to,
 * the way to a human, and the two account controls App Review requires to be
 * reachable from inside the app.
 */
function BusinessAccount({ name }: { name: string | null }) {
  const theme = useTheme();
  // Deleting an account is a round trip to an Edge Function, and the founder
  // read the silence in between as "it didn't delete my account immediately".
  const [deleting, setDeleting] = useState(false);

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ headerTitle: 'Your profile' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.guestContent}>
        <ThemedText type="display" style={styles.guestText}>
          {name ?? 'Your account'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.guestText}>
          Everything about your business lives on the My business tab.
        </ThemedText>
        {/* navigate, not back: this button named a tab and then returned to
            whichever one the owner had come from, so an owner who opened it
            from Chat was handed Chat again. navigate pops to the tabs that
            are already underneath this page and selects the one named,
            rather than stacking a second copy of the whole navigator. */}
        <PrimaryButton
          label="Manage your business"
          onPress={() => router.navigate('/(tabs)/my-business')}
        />
        {/* The undo for the one-time push primer - the same row travelers
            get, because a reply to a room lands the same way. */}
        <NotificationsRow />
        {/* The rules a business is actually held to, on the page rather than
            behind a button: it is four short lines, and the button it
            replaces opened the traveler rulebook, which talks about pins and
            "your profile" and bans commercial solicitation. */}
        <View style={[styles.rules, { backgroundColor: theme.surface }]}>
          <ThemedText type="callout">{BUSINESS_ZERO_TOLERANCE}</ThemedText>
          {BUSINESS_RULE_SECTIONS.map((section) => (
            <View key={section.title} style={styles.rulesSection}>
              <ThemedText type="footnote">{section.title}</ThemedText>
              <ThemedText type="footnote" themeColor="textSecondary">
                {section.body}
              </ThemedText>
            </View>
          ))}
        </View>
        {/* The way to a human, which used to be two taps inside the traveler
            guidelines. Nobody looking for help should have to read a rulebook
            written for somebody else to find it. */}
        <PrimaryButton
          variant="ghost"
          label="Send us a message"
          onPress={() => router.push('/contact')}
        />
        {/* The policy, on the one page a business account has. It was the
            only one of the three profile variants with no route to /privacy
            at all: the traveler page and the guest page both carry this
            button, and a business owner who wanted to know what we do with
            their data - or an App Reviewer signed in on the business demo
            account looking for 5.1.1(i) - had nowhere to go from here. */}
        <PrimaryButton variant="ghost" label="Privacy" onPress={() => router.push('/privacy')} />
        <PrimaryButton
          variant="ghost"
          label="Sign out"
          onPress={() => {
            signOut().catch(() => Alert.alert('Sign out failed', 'Try again.'));
          }}
        />
        {/* App Review 5.1.1(v), and the same weight the traveler page gives
            the same act. It was a ghost button here, so the one irreversible
            control on the page rendered in accent blue, identical to Sign out
            directly above it. */}
        <PrimaryButton
          variant="danger"
          label="Delete account"
          loading={deleting}
          onPress={() =>
            Alert.alert(
              'Delete this account?',
              'Your business comes off the map and everything on it goes: photos, posts, hours, links, ratings and its chat. This cannot be undone.',
              [
                { text: 'Keep it', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  // Await it, sign out, and LEAVE. This used to fire and
                  // forget, so the account was gone from the server while the
                  // phone went on holding a session for a user that no longer
                  // existed: the founder deleted their business and was still
                  // looking at the app as themselves. Awaiting fixed half of
                  // it. The other half is this screen, which is not behind
                  // any guard and so survives the sign-out it triggers, still
                  // showing a deleted business's name.
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await deleteAccount();
                    } catch {
                      setDeleting(false);
                      Alert.alert('Could not delete that', 'Try again in a minute.');
                      return;
                    }
                    await signOut().catch(() => {});
                    router.replace('/join');
                  },
                },
              ]
            )
          }
        />
        <BuildStamp />
      </ScrollView>
    </ThemedView>
  );
}

export default function ProfileScreen() {
  // Deleting is a round trip to an Edge Function that empties five storage
  // buckets, so the button has to say it is working. See the business branch
  // above for the rest of the reasoning.
  const [deleting, setDeleting] = useState(false);
  // Not "has a session": a guest has one. The member page below reads
  // photos, trips, prompts and handles, none of which a guest can have, so
  // the question is membership.
  const isGuest = useIsGuest();
  const isGuestAccount = useIsGuestAccount();
  const ownBusiness = useOwnBusiness();
  const { data: profile } = useOwnProfile();
  const { data: audience = 'everyone' } = useOwnVisibility();
  const ownPhotos = useOwnPhotos();
  const photos = ownPhotos.data ?? [];
  // What a stranger would actually be served. The page below says it is
  // exactly what they see, and it was showing photos they cannot: with photo
  // moderation on, a rejected shot stayed on your own profile looking live,
  // so the removal notification and the page disagreed and the page won.
  const visiblePhotos = photos.filter((photo) => photo.moderation_status === 'approved');
  const heldBack = photos.length - visiblePhotos.length;
  // A check that gave up is NOT a rules breach - the database records
  // photo_rejected_failsafe and no strike is counted - so it must not be
  // announced in the same sentence and the same red as one.
  //
  // The two are COUNTED rather than flagged, because somebody can hold one of
  // each. A pair of booleans read failsafe-first told that person the whole
  // thing was a timeout and invited them to upload again, which sends the
  // photo that really was refused back through the check and costs a second
  // strike. The rules rejection wins the sentence and the colour; the tile
  // chips still say which of the two each individual photo was.
  const rejectedPhotos = photos.filter((photo) => photo.moderation_status === 'rejected');
  const photoFailsafeCount = rejectedPhotos.filter(
    (photo) => photo.moderation_engine === 'failsafe'
  ).length;
  const photoRuleRejectedCount = rejectedPhotos.length - photoFailsafeCount;
  const photoNotice = heldPhotoNotice({
    heldBack,
    rejected: photoRuleRejectedCount,
    failsafe: photoFailsafeCount,
  });
  const { data: handles = [] } = useOwnSocialHandles();
  const { data: verification } = useLatestVerification();
  const { data: prompts = [] } = useProfilePrompts(useOwnUserId());
  const { data: priorities = [] } = useProfilePriorities(useOwnUserId());
  const { data: trips = [] } = useMyTrips();

  if (!isSupabaseConfigured) {
    return (
      <PlaceholderScreen
        configError
        icon={{ ios: 'person.crop.circle', android: 'person', web: 'person' }}
      />
    );
  }

  if (isGuest) {
    return <GuestProfile guestName={isGuestAccount ? (profile?.display_name ?? null) : null} />;
  }

  // Before the `!profile` bail below, because a business account HAS a
  // profile row (display_name is its name) and would otherwise fall through
  // to the traveler page.
  if (ownBusiness.data != null) {
    return <BusinessAccount name={ownBusiness.data.name} />;
  }

  if (!profile) {
    return (
      <ThemedView style={styles.root}>
        <Stack.Screen options={{ headerTitle: 'Your profile' }} />
      </ThemedView>
    );
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
      {/* Name the screen. The layout forces headerTitle '' (the bar is
          shared with pages that draw their own title); 'Your profile' over
          the person's own name because they know who they are — the value
          of the bar is saying which screen this is. */}
      <Stack.Screen options={{ headerTitle: 'Your profile' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.pageContent}>
        {/* First thing on the page, before the profile itself.
            Founder: "make the selection of which users you want to see and
            which can see you more prominent... I'd put it right at the top as
            a key selector as I imagine all users will want to have this set
            properly."

            It was a ghost button at the bottom, under Edit profile and Get
            verified, which is where a setting gets found by accident rather
            than on purpose. It shows the current value, because a control
            that does not say what it is set to is a link, not a selector. */}
        <AudienceCard audience={audience} onPress={() => router.push('/visibility')} />

        {/* Exactly the page a stranger gets, with edit affordances on top —
            the only way to know what your profile actually looks like. */}
        {heldBack > 0 ? (
          /* The label is the sentence itself, not "Manage your photos". A
             Pressable's own accessibilityLabel REPLACES its children, so the
             static label meant the one reader who cannot see the notice never
             heard why a photo was held, which is its entire content. Built
             from the same helper so the two can never say different things;
             the hint carries what tapping does. */
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={photoNotice}
            accessibilityHint="Opens your photos."
            onPress={() =>
              router.push({ pathname: '/edit-profile', params: { section: 'photos' } })
            }
            style={styles.photoNotice}>
            <ThemedText
              type="footnote"
              themeColor={
                photoRuleRejectedCount > 0
                  ? 'danger'
                  : photoFailsafeCount > 0
                    ? 'warning'
                    : 'textSecondary'
              }>
              {photoNotice}
            </ThemedText>
          </Pressable>
        ) : null}
        <ProfileView
          photosPending={ownPhotos.data === undefined}
          profile={profile}
          photos={visiblePhotos}
          prompts={prompts}
          priorities={priorities}
          trips={profileTrips}
          handles={handles}
          owner
          onEditSection={(section) =>
            router.push({ pathname: '/edit-profile', params: { section } })
          }
          onEditPrompt={(slot) =>
            router.push({
              pathname: '/edit-prompt',
              params: slot == null ? {} : { slot: String(slot) },
            })
          }
          onEditPriorities={(slot) =>
            router.push({
              pathname: '/edit-priorities',
              params: slot == null ? {} : { slot: String(slot) },
            })
          }
          actions={
            <>
              <PrimaryButton label="Edit profile" onPress={() => router.push('/edit-profile')} />
              {!profile.verified ? (
                <PrimaryButton
                  variant="ghost"
                  label={verification?.status === 'pending' ? 'In review' : 'Get verified'}
                  onPress={() => router.push('/verification')}
                />
              ) : null}
              {/* The undo for the one-time push primer. Reads the OS, and
                  renders nothing where push can never work. */}
              <NotificationsRow />
              {/* No "Who you see, and who sees you" here any more. It is the
                  card at the top of this page: a setting this consequential
                  should not be the fourth ghost button under the fold. */}
              <PrimaryButton
                variant="ghost"
                label="House rules and help"
                onPress={() => router.push('/guidelines')}
              />
              {/* The policy the consent line promised at sign-up, findable
                  again afterwards without re-reading the rulebook. */}
              <PrimaryButton
                variant="ghost"
                label="Privacy"
                onPress={() => router.push('/privacy')}
              />
              {/* Without this the answer is a dead end. A business is its own
                  account by design (decision 5), and register_business refuses
                  an account that has already finished a traveler profile, so
                  somebody who onboarded first and THEN wants to list their bar
                  has no route at all from inside the app. Saying it plainly and
                  offering the one step that works beats leaving them to guess
                  that signing out is the answer. */}
              <PrimaryButton
                variant="ghost"
                label="Run a business?"
                onPress={() =>
                  Alert.alert(
                    'A business gets its own account',
                    "Yours is a traveler account, and the two work differently, so a business needs one of its own. It's free. Sign out, make a new account, and the offer is on the first screen.",
                    [
                      { text: 'Not now', style: 'cancel' },
                      {
                        text: 'Sign out',
                        onPress: () => {
                          signOut().catch(() => Alert.alert('Sign out failed', 'Try again.'));
                        },
                      },
                    ]
                  )
                }
              />
              <PrimaryButton
                variant="ghost"
                label="Sign out"
                onPress={() => {
                  signOut().catch(() => Alert.alert('Sign out failed', 'Try again.'));
                }}
              />
              {/* The one place the global scope belongs: the standard remedy
                  after a lost phone. Everywhere else "Sign out" means this
                  device, which is what the words say. */}
              <PrimaryButton
                variant="ghost"
                label="Sign out on all devices"
                onPress={() =>
                  Alert.alert(
                    'Sign out on all devices?',
                    'Signs you out here and on every other phone or tablet where you are signed in.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Sign out everywhere',
                        onPress: () => {
                          signOutEverywhere().catch(() =>
                            Alert.alert('Sign out failed', 'Try again.')
                          );
                        },
                      },
                    ]
                  )
                }
              />
              {/* App Review 5.1.1(v): account deletion must be available in-app. */}
              <PrimaryButton
                variant="danger"
                label="Delete account"
                loading={deleting}
                onPress={() => {
                  Alert.alert(
                    'Delete your account?',
                    "Deletes your profile, photos, trips, pins and chats, for both sides. Can't be undone.",
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Delete forever',
                        style: 'destructive',
                        onPress: async () => {
                          setDeleting(true);
                          try {
                            await deleteAccount();
                          } catch {
                            setDeleting(false);
                            Alert.alert('Deletion failed', 'Check your connection and try again.');
                            return;
                          }
                          // The auth user no longer exists, and this screen is
                          // outside every route guard, so it survives its own
                          // sign-out still showing a deleted profile. Both
                          // halves, in the order they have to happen.
                          await signOut().catch(() => {});
                          router.replace('/join');
                        },
                      },
                    ]
                  );
                }}
              />
              <BuildStamp />
            </>
          }
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  rules: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
  },
  rulesSection: {
    gap: Space.xs,
  },
  photoNotice: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.sm,
  },
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
    // Air between the audience card and the identity band under it: in the
    // same fill and flush, the setting read as part of the profile rather
    // than as its own object.
    gap: Space.md,
  },
});
