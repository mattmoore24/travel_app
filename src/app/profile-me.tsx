import { Image } from 'expo-image';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import { Alert, PixelRatio, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { BuildStamp } from '@/components/ui/build-stamp';
import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { PressableScale } from '@/components/ui/pressable-scale';
import { heldPhotoNotice } from '@/constants/moderation';
import { BrandDeep, MaxContentWidth, Radius, Space } from '@/constants/theme';
import { BUSINESS_RULE_SECTIONS, BUSINESS_ZERO_TOLERANCE } from '@/constants/policies';
import { signOut, signOutEverywhere } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { deleteAccount } from '@/features/profile/api';
import {
  useOwnUserId,
  useProfilePriorities,
  useProfilePrompts,
  useLatestVerification,
  useOwnPhotos,
  useOwnProfile,
  useOwnEmail,
  useOwnSocialHandles,
  useOwnVisibility,
} from '@/features/profile/hooks';
import { AUDIENCE_LABEL } from '@/features/profile/audience';
import { useApplyWantedAudience } from '@/features/profile/wanted-audience';
import { AudienceCard } from '@/features/profile/audience-picker';
import { ProfileView, type ProfileTrip } from '@/features/profile/profile-view';
import { useDropListingIntent, useOwnBusiness } from '@/features/business/hooks';
import { NotificationsRow } from '@/features/notifications/notifications-row';
import { GUEST_SWEEP_LINE } from '@/features/guest/copy';
import { FinishYourProfileCard } from '@/features/profile/finish-card';
import { useIsGuest, useIsGuestAccount, useWantsBusiness } from '@/features/guest/hooks';
import { useMyTrips } from '@/features/trips/hooks';
import { useTheme } from '@/hooks/use-theme';
import { analytics } from '@/lib/analytics';
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
 * page is deliberately short: the rules a business is held to, the way to a
 * human, and the two account controls App Review requires to be reachable from
 * inside the app.
 *
 * And it is SETTINGS, not a second front door. It used to open with a large
 * "Manage your business" button and a subtitle explaining it, which made the
 * account page and the My business tab two doors onto one room: an owner who
 * came here from the tab was handed a button back to the tab. The way back is
 * the back gesture, which is also what avatar-button offers from Map and Chat,
 * and it returns to whatever tab the owner came from - correct for a settings
 * screen, and it is the surface the removed button's own bug lived on.
 * Retitled to match: a business account has no profile.
 */
function BusinessAccount({ name }: { name: string | null }) {
  const theme = useTheme();
  // Deleting an account is a round trip to an Edge Function, and the founder
  // read the silence in between as "it didn't delete my account immediately".
  const [deleting, setDeleting] = useState(false);

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ headerTitle: 'Account' }} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.guestContent}>
        <ThemedText type="display" style={styles.guestText}>
          {name ?? 'Your account'}
        </ThemedText>
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
        {/* An owner is as likely as a traveler to lose an inbox or a phone,
            and until now the only route to either change was the signed-out
            "Forgot your password?" screen. */}
        <PrimaryButton
          variant="ghost"
          label="Email and password"
          onPress={() => router.push('/account-credentials')}
        />
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

/** Past this font scale the card-plus-pill row becomes a column. */
const PREVIEW_STACK_SCALE = 1.3;

/**
 * One row of the Settings list.
 *
 * The page used to end in a stack of eight identical full-width ghost
 * buttons: Edit profile weighted the same as House rules, which weighted the
 * same as Sign out. Apple's grouped-list grammar is what every iPhone owner
 * already reads settings in - a label, a value, a chevron, hairlines between
 * and a heading over each group - and it is the only way somebody scanning
 * for their email address or a blocked list can tell "not here" from
 * "further down".
 */
function SettingsRow({
  label,
  value,
  detail,
  tone = 'normal',
  first = false,
  onPress,
}: {
  label: string;
  /** The current setting, where the row has one. Sits at the right. */
  value?: string | null;
  /** A second line under the label, for a fact rather than a setting. */
  detail?: string | null;
  /** 'action' is a thing that happens here rather than a place to go. */
  tone?: 'normal' | 'action';
  first?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[label, detail, value].filter(Boolean).join(', ')}
      haptic="light"
      scaleTo={0.99}
      onPress={onPress}
      style={[
        styles.settingsRow,
        // Hairlines BETWEEN rows, not around them: a border on every row
        // draws a double line at every join.
        first ? null : { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.hairline },
        tone === 'action' ? styles.settingsRowAction : null,
      ]}>
      {tone === 'action' ? (
        <ThemedText themeColor="accent">{label}</ThemedText>
      ) : (
        <View style={styles.flex}>
          <ThemedText>{label}</ThemedText>
          {detail ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {detail}
            </ThemedText>
          ) : null}
        </View>
      )}
      {tone === 'action' ? null : (
        <>
          {value ? (
            <ThemedText type="footnote" themeColor="textSecondary" numberOfLines={1}>
              {value}
            </ThemedText>
          ) : null}
          <SymbolView
            name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
            size={13}
            tintColor={theme.textSecondary}
          />
        </>
      )}
    </PressableScale>
  );
}

/** A titled group of rows, drawn as one card. */
function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.settingsGroup}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.settingsGroupTitle}>
        {title}
      </ThemedText>
      <View style={[styles.settingsCard, { backgroundColor: theme.surface }]}>{children}</View>
    </View>
  );
}

export default function ProfileScreen() {
  const theme = useTheme();
  // Deleting is a round trip to an Edge Function that empties five storage
  // buckets, so the button has to say it is working. See the business branch
  // above for the rest of the reasoning.
  const [deleting, setDeleting] = useState(false);
  // Reading your own page as a stranger gets it. The page below claims in its
  // own comment to be exactly that, and in the way that matters it is not: a
  // stranger's copy is covered in reply chips and yours has Edit buttons in
  // the same slots, so you can never notice that your bio has nothing worth
  // tapping.
  const [previewing, setPreviewing] = useState(false);
  // Seeded from the SDK's persisted answer rather than from false, so a
  // relaunch shows what the person actually chose last time instead of
  // telling them analytics is on until they toggle it twice.
  const [analyticsOff, setAnalyticsOff] = useState(() => analytics.optedOut());
  // Not "has a session": a guest has one. The member page below reads
  // photos, trips, prompts and handles, none of which a guest can have, so
  // the question is membership.
  const isGuest = useIsGuest();
  const isGuestAccount = useIsGuestAccount();
  const ownBusiness = useOwnBusiness();
  // Part way through listing a business, from the database rather than from
  // memory. It is what turns the "Run a business?" explanation into a door
  // back into the form somebody has already started.
  const wantsBusiness = useWantsBusiness();
  const dropListingIntent = useDropListingIntent();
  const listingDone = useAuthStore((s) => s.listingDone);
  const { data: profile } = useOwnProfile();
  const { data: audience = 'everyone' } = useOwnVisibility();
  // The address the account is under. Email confirmation is off for v1, so a
  // typo at signup produces a working account that never receives a single
  // piece of mail revealing the mistake - and until now nothing in the app
  // ever showed it back.
  const email = useOwnEmail();
  // An Apple account has no password of ours; the credentials screen says so,
  // and the row that opens it should say so first.
  const signsInWithApple = useAuthStore((s) => s.session?.user.app_metadata?.provider === 'apple');
  const ownPhotos = useOwnPhotos();
  const photos = ownPhotos.data ?? [];
  // What a stranger would actually be served. The page below says it is
  // exactly what they see, and it was showing photos they cannot: with photo
  // moderation on, a rejected shot stayed on your own profile looking live,
  // so the removal notification and the page disagreed and the page won.
  const approvedPhotos = photos.filter((photo) => photo.moderation_status === 'approved');
  const heldBack = photos.length - approvedPhotos.length;
  // The one exception to "show them exactly what a stranger sees": while the
  // ONLY photo is still being checked, showing nothing meant the page fell
  // through to the photo-less band and offered an "Add a photo" button to
  // somebody who had just added one. It renders behind the same scrim and the
  // same sentence a chat photo gets, so the page says "we are looking at it"
  // rather than "there is nothing here".
  const checkingHero =
    approvedPhotos.length === 0
      ? (photos.find((photo) => photo.moderation_status !== 'rejected') ?? null)
      : null;
  const visiblePhotos = checkingHero ? [checkingHero] : approvedPhotos;
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
  // Spend the audience somebody reached for on signup step 12 but could not
  // have yet. The check takes minutes; that step is seconds. This is the
  // screen that lands after signup and already reads profile.verified, so it
  // is where the promise the note made is actually kept.
  useApplyWantedAudience(profile?.verified === true, audience);
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

  // At accessibility sizes the card and the pill laddered side by side; a
  // full-width card with the pill under it reads.
  const stackPreview = PixelRatio.getFontScale() > PREVIEW_STACK_SCALE;
  // Just the city, not "Bangkok, Thailand": the banner is a sentence.
  const previewCity = trips[0]?.cities.name ?? null;

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
        <View style={[styles.audienceRow, stackPreview && styles.audienceRowStacked]}>
          <View style={styles.flex}>
            <AudienceCard audience={audience} onPress={() => router.push('/visibility')} />
          </View>
          {/* The whole value of one component rendering both sides is being
              able to LOOK at the other one. It is the same page, not a second
              layout: owner off, handles empty (hard rule 4 - a preview that
              kept your own handles would teach the opposite of the promise),
              and the reply chips a stranger sees drawn where yours says
              Edit. */}
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              previewing
                ? 'Stop previewing your profile'
                : 'Preview your profile as a stranger sees it'
            }
            accessibilityState={{ selected: previewing }}
            haptic="light"
            scaleTo={0.94}
            hitSlop={8}
            onPress={() => setPreviewing((on) => !on)}
            style={[
              styles.previewPill,
              { backgroundColor: previewing ? theme.accent : theme.surfaceSunken },
            ]}>
            <ThemedText
              type="footnote"
              style={previewing ? { color: theme.onAccent } : undefined}
              themeColor={previewing ? undefined : 'accent'}>
              {previewing ? 'Done' : 'Preview'}
            </ThemedText>
          </PressableScale>
        </View>

        {previewing ? (
          <>
            {/* Named, so it cannot be mistaken for the real page. The city is
                the one a stranger would be reading this in; without a trip
                there is no city to name and the sentence says who instead. */}
            <View style={[styles.previewBanner, { backgroundColor: theme.surfaceSunken }]}>
              <SymbolView
                name={{ ios: 'eye', android: 'visibility', web: 'visibility' }}
                size={15}
                tintColor={theme.textSecondary}
              />
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.flex}>
                {previewCity
                  ? `This is what ${previewCity} sees`
                  : 'This is what other travelers see'}
              </ThemedText>
            </View>
            <ProfileView
              photosPending={ownPhotos.data === undefined}
              profile={profile}
              photos={approvedPhotos}
              prompts={prompts}
              priorities={priorities}
              trips={profileTrips}
              handles={[]}
              owner={false}
              // The chips have to be THERE - they are what a stranger's copy
              // is covered in and the reason to look - but they lead to a
              // composer for yourself. Leaving preview is the honest thing
              // for them to do: a no-op handler still fired the PressableScale
              // haptic and animation on every trip card and every prompt
              // answer, so the page buzzed and confirmed an action that had
              // not happened. Now the tap means "take me back to my profile",
              // which is the only thing it could sensibly mean here.
              onRespondTo={() => setPreviewing(false)}
            />
          </>
        ) : (
          <>
            {/* The second ask for the six sections signup let people skip.
            Nothing anywhere used to notice that a profile had no prompt, no
            priorities and no bio, while the Travelers screen is built to show
            all three - so somebody who skipped everything ended with a photo
            and a name and was never told. It draws nothing at all once the
            last gap closes, and it can be put away for the session. */}
            {/* Never to an account part way through listing a business. It is on
            this page only because the tabs are mounted for it, and asking a
            bar owner for a trip and a bio is asking them to finish the one
            flow register_business refuses. */}
            {wantsBusiness ? null : (
              <FinishYourProfileCard
                profile={profile}
                prompts={prompts}
                priorities={priorities}
                trips={trips}
                handles={handles}
              />
            )}

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
              photoChecking={checkingHero != null}
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
                /* A Settings spine, not eight identical ghost buttons.
                   Reaching a human used to be four taps and two long scrolls
                   through a rulebook written for somebody else, and somebody
                   looking for their email address or a blocked list had no
                   way to tell that those things were further down rather
                   than absent. Every row leads somewhere real: the founder's
                   own rule is that a row opening nothing is worse than no
                   row, which is why there is no Notifications row here (the
                   card below is the whole notification control there is). */
                <View style={styles.settingsList}>
                  <ThemedText type="title">Settings</ThemedText>

                  <SettingsGroup title="Your profile">
                    <SettingsRow
                      first
                      label="Edit profile"
                      onPress={() => router.push('/edit-profile')}
                    />
                    {/* The same destination as the card at the top of the
                        page. The card stays where it is - it is the founder's
                        key selector and this list must not demote it - but a
                        person hunting through Settings for a privacy control
                        looks in Settings. */}
                    <SettingsRow
                      label="Who you see, and who sees you"
                      value={AUDIENCE_LABEL[audience]}
                      onPress={() => router.push('/visibility')}
                    />
                    {profile.verified ? null : (
                      <SettingsRow
                        label="Get verified"
                        value={verification?.status === 'pending' ? 'In review' : null}
                        onPress={() => router.push('/verification')}
                      />
                    )}
                    {/* The undo for a one-way door. Blocking cuts visibility
                        both ways and had no inventory at all, so blocking the
                        wrong person from a crowded group thread could not be
                        undone or even looked at. */}
                    {/* Only for an account that finished onboarding.
                        /blocked is registered inside
                        `Stack.Protected guard={signedIn && onboarded}`, and an
                        account part way through listing a business reaches
                        this branch (owesOnboarding returns false for it so the
                        tabs mount) while `onboarded` is still false - so for
                        them this row led to a route the navigator does not
                        have, and did nothing at all. */}
                    {profile.onboarding_completed_at == null ? null : (
                      <SettingsRow label="Blocked" onPress={() => router.push('/blocked')} />
                    )}
                  </SettingsGroup>

                  {/* The undo for the one-time push primer. Reads the OS, and
                      renders nothing where push can never work. */}
                  <NotificationsRow />

                  <SettingsGroup title="Help and rules">
                    <SettingsRow
                      first
                      label="House rules and help"
                      onPress={() => router.push('/guidelines')}
                    />
                    {/* The policy the consent line promised at sign-up,
                        findable again afterwards without re-reading the
                        rulebook. */}
                    <SettingsRow label="Privacy" onPress={() => router.push('/privacy')} />
                    {/* The control the privacy policy's answer to App Store
                        5.1.1(i) names. It existed in analytics.ts with no
                        call site anywhere in the app, so the policy said
                        there was no opt-out, DASHBOARD.md said this was the
                        mechanism, and the code agreed with neither: it was
                        there and unreachable.

                        A row rather than a switch, because SettingsRow is
                        what this group is made of and its `value` already
                        carries the current state to a screen reader. */}
                    <SettingsRow
                      label="Usage analytics"
                      value={analyticsOff ? 'Off' : 'On'}
                      detail="Which screens get opened, never what you write."
                      onPress={() => {
                        const next = !analyticsOff;
                        analytics.setOptedOut(next);
                        setAnalyticsOff(next);
                      }}
                    />
                    {/* Straight to a human. It used to be two taps inside the
                        guidelines, which is a rulebook, not a help desk. */}
                    <SettingsRow
                      label="Send us a message"
                      onPress={() => router.push('/contact')}
                    />
                  </SettingsGroup>

                  <SettingsGroup title="Account">
                    {/* The remedy after a phone goes missing, and the only
                        route to a new address. Both used to live on the
                        SIGNED OUT screen behind "Forgot your password?", so
                        using either meant giving up the session first. */}
                    <SettingsRow
                      first
                      label="Email and password"
                      // Both facts, on one line: the address the account is
                      // under, and how it signs in. An Apple account has no
                      // password of ours at all, and somebody who tapped
                      // through expecting one should know before they do.
                      detail={
                        email
                          ? signsInWithApple
                            ? `${email}, through Apple`
                            : email
                          : signsInWithApple
                            ? 'Through Apple'
                            : null
                      }
                      onPress={() => router.push('/account-credentials')}
                    />
                    {/* Two different people, and telling them apart is the
                        whole point. An account carrying the listing flag has
                        already started: it needs the door back into the form,
                        not a lecture about signing out. Everyone else gets
                        the explanation, because a business is its own account
                        by design (decision 5) and register_business refuses
                        an account that has already finished a traveler
                        profile. */}
                    {wantsBusiness ? (
                      <SettingsRow
                        label="Finish listing your business"
                        // REPLACE, never push. business-signup's whole exit
                        // design rests on nothing being underneath it: when
                        // register_business succeeds it flips isBusiness, the
                        // root's guards change, and any route left below is
                        // filtered out from under a live screen — which is the
                        // crash this file's tests exist to prevent, and which
                        // a push from here reproduced on the e2e suite for
                        // three runs. join.tsx enters the same screen with a
                        // replace for the same reason.
                        onPress={() => router.replace('/business-signup')}
                      />
                    ) : (
                      <SettingsRow
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
                                  signOut().catch(() =>
                                    Alert.alert('Sign out failed', 'Try again.')
                                  );
                                },
                              },
                            ]
                          )
                        }
                      />
                    )}
                    {/* And the way to say the listing is off. Without it the
                        flag is one-way: the tabs stay mounted, traveler
                        onboarding is never asked for again, and the row above
                        offers a form the person has decided against. */}
                    {wantsBusiness ? (
                      <SettingsRow
                        label="Not listing a business after all"
                        onPress={() =>
                          Alert.alert(
                            'Drop the listing?',
                            'You will finish a traveler profile instead, starting now. Listing a business later needs its own separate account, so this one cannot go back.',
                            [
                              { text: 'Keep it', style: 'cancel' },
                              {
                                text: 'Drop it',
                                onPress: () => {
                                  listingDone();
                                  dropListingIntent.mutate();
                                },
                              },
                            ]
                          )
                        }
                      />
                    ) : null}
                  </SettingsGroup>

                  {/* Its own group at the bottom, which is the whole weighting
                      fix: Sign out used to be a ghost button identical to
                      House rules directly above it. */}
                  <SettingsGroup title="Leaving">
                    <SettingsRow
                      first
                      tone="action"
                      label="Sign out"
                      onPress={() => {
                        signOut().catch(() => Alert.alert('Sign out failed', 'Try again.'));
                      }}
                    />
                    {/* The one place the global scope belongs: the standard
                        remedy after a lost phone. Everywhere else "Sign out"
                        means this device, which is what the words say. */}
                    <SettingsRow
                      tone="action"
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
                  </SettingsGroup>

                  {/* App Review 5.1.1(v): account deletion must be available
                      in-app, and it keeps the weight its own act deserves
                      rather than becoming a row like the rest. */}
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
                                Alert.alert(
                                  'Deletion failed',
                                  'Check your connection and try again.'
                                );
                                return;
                              }
                              // The auth user no longer exists, and this
                              // screen is outside every route guard, so it
                              // survives its own sign-out still showing a
                              // deleted profile. Both halves, in the order
                              // they have to happen.
                              await signOut().catch(() => {});
                              router.replace('/join');
                            },
                          },
                        ]
                      );
                    }}
                  />
                  <BuildStamp />
                </View>
              }
            />
          </>
        )}
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
  flex: {
    flex: 1,
  },
  audienceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.lg,
  },
  audienceRowStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  previewPill: {
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
  },
  settingsGroup: {
    gap: Space.xs,
  },
  settingsGroupTitle: {
    paddingHorizontal: Space.sm,
  },
  settingsCard: {
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    // 44 is the floor, and the row grows past it with Dynamic Type rather
    // than clipping its own label.
    minHeight: 48,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
  },
  settingsRowAction: {
    justifyContent: 'center',
  },
  settingsList: {
    gap: Space.lg,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginHorizontal: Space.lg,
    padding: Space.md,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
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
