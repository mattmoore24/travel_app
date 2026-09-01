import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useState, type ReactNode } from 'react';

// Side effect: installs the foreground notification handler at module scope,
// so it exists from launch rather than whenever the tabs happen to pull the
// module in through the push primer.
import '@/features/notifications/push';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ConnectionBanner } from '@/components/ui/connection-banner';
import { IntroTour } from '@/features/intro/intro-tour';
import { useIntroState } from '@/features/intro/store';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, MaxContentWidth, Spacing, SplashField } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAppleRevokeWatch } from '@/features/auth/apple-revoke';
import { accountLoadFailure } from '@/features/auth/load-error';
import { signedOutNoticeCopy, type SignedOutReason } from '@/features/auth/signed-out-reason';
import { useAuthStore } from '@/features/auth/store';
import { ResetPasswordScreen } from '@/features/auth/reset-password-screen';
import { owesOnboarding, rootIsReady } from '@/features/auth/routing';
import { gateCopy, type GateView } from '@/features/auth/gate-copy';
import { useAuthListener } from '@/features/auth/use-auth-listener';
import { useListingIntent, useOwnBusiness } from '@/features/business/hooks';
import { useAccountStanding, useOwnProfile } from '@/features/profile/hooks';
import { ContactForm } from '@/features/support/contact-form';
import { GuidelinesBody } from '@/features/support/guidelines-body';
import { queryClient } from '@/lib/query-client';
import { isSupabaseConfigured } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

/**
 * The route the stack falls back to when it has nowhere else to go.
 *
 * A deep link opened from a cold start builds a navigation state containing
 * ONLY the linked route — so an invite arriving on somebody's first launch
 * gave them a screen with no tab bar, no back button, and a `router.back()`
 * that dispatched a GO_BACK no navigator was able to handle. Nothing threw;
 * the tap simply did nothing, twice, and the app read as broken. The anchor
 * puts the tabs underneath every cold-start link, so there is always
 * somewhere to go back to.
 */
export const unstable_settings = { anchor: '(tabs)' };

/**
 * The centred column both root-level dead ends are drawn in: the load error
 * and the account gate.
 *
 * It SCROLLS, and that is the whole point of it being a component. A centred
 * View was right while the gate held a title, one line of body and a single
 * Sign out. The gate now holds a title, a paragraph, and three buttons — and
 * at the larger Dynamic Type sizes the last of them, Appeal this, fell off
 * the bottom of the one screen in the app whose entire purpose is giving a
 * suspended or closed account a way back. Nothing scrolled, so there was no
 * way to reach it: on that screen the appeal route did not exist.
 *
 * flexGrow: 1 with a centred content container is the pairing that serves
 * both: the short case stays vertically centred and the tall case scrolls.
 * The padding and the gap live on the content container rather than the
 * static style for the same reason — on a ScrollView they belong to the
 * content, not to the frame.
 */
function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <ThemedView style={styles.errorRoot}>
      <SafeAreaView style={styles.errorContent}>
        <ScrollView contentContainerStyle={styles.errorScroll}>{children}</ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

// Shown when we're signed in but a fetch the router depends on failed
// (offline cold start, server error) — without it, users would be routed into
// a blank onboarding stack with no way out.
function AccountLoadError({
  title,
  error,
  onRetry,
  retrying,
}: {
  title: string;
  /** The failure itself, so the screen can tell a bad wifi from a gone row. */
  error: unknown;
  onRetry: () => void;
  retrying: boolean;
}) {
  // "Check your connection and try again" over a Try again button was what
  // this said when the account no longer EXISTS - deleted on another device,
  // swept by the guest janitor, removed by an admin - and that button can
  // never succeed. Read off the error rather than guessed: PostgrestError is
  // not an Error, so instanceof would swallow it (features/auth/load-error).
  const closed = accountLoadFailure(error) === 'gone';
  return (
    <CenteredPage>
      <ThemedText type="title" style={styles.errorText}>
        {closed ? 'This account has been closed' : title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.errorText}>
        {closed
          ? 'We cannot find it any more. It may have been deleted from another device. Sign out and you can make a new one.'
          : 'Check your connection and try again.'}
      </ThemedText>
      {/* The same words as the body copy above it. "Retry" is a
          developer's word, and two labels for one act is one too many. */}
      {closed ? null : <PrimaryButton label="Try again" loading={retrying} onPress={onRetry} />}
      <PrimaryButton
        // The only thing left to do, so it looks like it.
        variant={closed ? 'filled' : 'ghost'}
        label="Sign out"
        onPress={() => {
          signOut().catch(() => {});
        }}
      />
    </CenteredPage>
  );
}

// The DB independently refuses suspended/banned accounts on the abuse
// channels (message requests, request responses, chat sends, verification);
// other writes are merely invisible to others via the visibility helpers.
// This screen tells the user what happened instead of surfacing permission
// errors — it is UX, not the enforcement layer.

/**
 * The one screen a suspended or closed account can reach, and until now the
 * only button on it was Sign out.
 *
 * docs/legal/COMMUNITY_GUIDELINES.md promises an appeal "from Contact us in
 * the app, which is open even when you cannot sign in", and the app had
 * hidden that from exactly this person: `guidelines` and `contact` are
 * declared inside the <Stack> this component is returned INSTEAD OF, so
 * router.push to either is a silent no-op here. That is why these are view
 * modes rather than navigation, and why the two bodies are components.
 *
 * Moving the gate inside the Stack as a Stack.Protected group is the
 * tempting alternative and it is a trap: it means adding `&& !gated` to every
 * other guard in this file and getting initial-route resolution right on a
 * cold start, in the one file whose comments already record four routing bugs
 * paid for in full.
 */
function AccountGate({
  status,
  suspendedUntil,
}: {
  status: string;
  suspendedUntil: string | null;
}) {
  const [view, setView] = useState<GateView>('gate');
  const copy = gateCopy(status, suspendedUntil);

  if (view === 'rules') {
    return (
      <ThemedView style={styles.gateRoot}>
        <SafeAreaView style={styles.gatePage}>
          <GuidelinesBody onContact={() => setView('appeal')} />
          <View style={styles.gateFooter}>
            <PrimaryButton label="Back" onPress={() => setView('gate')} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (view === 'appeal') {
    return (
      <ThemedView style={styles.gateRoot}>
        {/* Top edge only. StepScreen's own SafeAreaView is edges={['bottom']}
            because every other thing that renders one is a modal route with a
            native header over it — and this one is returned INSTEAD OF the
            <Stack>, so there is no header and no modal card. Bare, the form's
            title drew under the status bar and into the notch. The bottom
            stays StepScreen's, which is where its docked Send button is. */}
        <SafeAreaView style={styles.gatePage} edges={['top']}>
          <ContactForm
            initialBody={copy.appeal}
            showReportHint={false}
            onDone={() => setView('gate')}
            onClose={() => setView('gate')}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <CenteredPage>
      <ThemedText type="title" style={styles.errorText}>
        {copy.title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.errorText}>
        {copy.body}
      </ThemedText>
      <PrimaryButton
        variant="ghost"
        label="Read the house rules"
        onPress={() => setView('rules')}
      />
      <PrimaryButton variant="ghost" label="Appeal this" onPress={() => setView('appeal')} />
      <PrimaryButton
        variant="ghost"
        label="Sign out"
        onPress={() => {
          signOut().catch(() => {});
        }}
      />
    </CenteredPage>
  );
}

/**
 * The session ended and nobody here asked for it.
 *
 * supabase-js emits one SIGNED_OUT event whether the person tapped Sign out
 * or the server threw the refresh token away, so a revoked session, a global
 * sign-out from another device, a deleted account and the guest sweep all
 * used to arrive as the app silently becoming the signed-out app: the chats
 * gone, the pins gone, the avatar a guest avatar, and nothing said.
 *
 * Rendered INSTEAD OF the stack, in the same position the recovery branch
 * pre-empts everything else, so there is no navigator while it is up. That is
 * why Sign in parks a flag rather than pushing a route: clearing the notice
 * remounts the stack at its anchor and any navigation dispatched a tick
 * earlier is dropped (the root-hold trap this file has already paid for). The
 * tabs spend the flag the moment they mount, exactly as they do the invite.
 */
function SignedOutNotice({ reason }: { reason: SignedOutReason }) {
  const seen = useAuthStore((s) => s.signedOutNoticeSeen);
  const signInWanted = useAuthStore((s) => s.signInWanted);
  const copy = signedOutNoticeCopy(reason);

  return (
    <CenteredPage>
      <ThemedText type="title" style={styles.errorText}>
        {copy.title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.errorText}>
        {copy.body}
      </ThemedText>
      <PrimaryButton
        label="Sign in"
        onPress={() => {
          signInWanted();
          seen();
        }}
      />
      <PrimaryButton variant="ghost" label="Not now" onPress={seen} />
    </CenteredPage>
  );
}

function RootNavigator() {
  useAuthListener();
  // Beside the auth listener because it is the same kind of thing: one watch,
  // mounted once, that can end a session. It notices somebody telling iOS to
  // stop using their Apple ID with this app, which nothing did before.
  useAppleRevokeWatch();
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const recovery = useAuthStore((s) => s.recovery);
  const signedOutNotice = useAuthStore((s) => s.signedOutNotice);
  const listingIntent = useAuthStore((s) => s.listingIntent);
  const intro = useIntroState();
  const profileQuery = useOwnProfile();
  const standingQuery = useAccountStanding();
  const businessQuery = useOwnBusiness();
  // "Part way through listing a business", from the database rather than from
  // memory. The in-memory flag is lost by a cold start, and losing it is what
  // put a bar owner into traveler onboarding: the one flow a business must
  // never finish, because register_business refuses an account that carries
  // the stamp it ends with.
  const listingQuery = useListingIntent();

  const signedIn = session != null;
  const onboarded = profileQuery.data?.onboarding_completed_at != null;
  // Not `signedIn && !onboarded`: a guest is signed in and can never be
  // onboarded, so that expression traps them. See features/auth/routing.
  // A business account is the second kind that can never be onboarded, and
  // for the same structural reason a guest cannot. See features/auth/routing.
  const isBusiness = businessQuery.data != null;
  // The store's flag OR the column, so the answer is right within a sitting
  // (the column is written a beat after the chooser) and right after a cold
  // start (the store is empty and the column is not).
  const wantsBusiness = listingIntent || listingQuery.data === true;
  const needsProfile = owesOnboarding(
    session,
    profileQuery.data?.onboarding_completed_at,
    isBusiness,
    wantsBusiness
  );
  // Hold routing until the persisted session is restored and (when signed in)
  // the first profile + standing fetches settle — otherwise users flash
  // through the wrong stack on cold start. The hold unmounts the navigator,
  // which is why a guest is exempt; see features/auth/routing.
  const ready = rootIsReady({
    initialized,
    session,
    supabaseConfigured: isSupabaseConfigured,
    profileSettled: profileQuery.isSuccess || profileQuery.isError,
    standingSettled: standingQuery.isSuccess || standingQuery.isError,
    businessSettled: businessQuery.isSuccess || businessQuery.isError,
    listingSettled: listingQuery.isSuccess || listingQuery.isError,
  });

  if (!ready || intro.seen === null) {
    // Splash-colored hold, not null: the splash overlay fades out on its own
    // clock, and fading over the window's white root would flash white if
    // readiness resolves late. Indigo under indigo is invisible.
    return <View style={styles.bootHold} />;
  }

  // `data == null` as well as isError. React Query keeps the cached row and
  // still flips status to 'error' on a BACKGROUND failure, and this branch
  // replaces the whole navigator — so one flaky refetch on returning to the
  // app took a traveler out of the conversation they were reading and put up
  // "Can't load your profile", with everything needed to draw the app sitting
  // in memory. Unmounting the stack also loses the route (see
  // features/auth/routing), so even Retry landed them back on the map.
  if (signedIn && profileQuery.isError && profileQuery.data == null) {
    return (
      <AccountLoadError
        title="Can't load your profile"
        error={profileQuery.error}
        onRetry={() => profileQuery.refetch()}
        retrying={profileQuery.isFetching}
      />
    );
  }

  // The same rule for the query that decides WHICH APP somebody gets.
  //
  // `businessSettled` counts an error as settled, and `isBusiness` is
  // `data != null`, so a failed my_business fetch on a cold start reads as
  // "not a business" — and owesOnboarding then reads a business's permanently
  // null onboarding_completed_at as unfinished and mounts the traveler
  // onboarding stack. A bar owner on bad wifi was asked for their first name,
  // their age and their photos, in a form every write of which
  // refuse_business_write rejects. Not knowing the account kind is a reason
  // to ask again, never a reason to guess traveler.
  if (signedIn && businessQuery.isError && businessQuery.data == null) {
    return (
      <AccountLoadError
        title="Can't load your account"
        error={businessQuery.error}
        onRetry={() => businessQuery.refetch()}
        retrying={businessQuery.isFetching}
      />
    );
  }

  const standing = standingQuery.data;
  if (signedIn && (standing?.status === 'suspended' || standing?.status === 'banned')) {
    return <AccountGate status={standing.status} suspendedUntil={standing.suspended_until} />;
  }

  // A recovery link signs you in, so this has to come BEFORE every other
  // branch: otherwise the guards see an ordinary session and swap into the
  // app, leaving the old password live on the account after an email round
  // trip taken specifically to change it.
  if (recovery != null) {
    return <ResetPasswordScreen />;
  }

  // After recovery (a live recovery session is a sign-in somebody is in the
  // middle of) and before the tour, which would otherwise greet a person
  // whose session just died as though they had never opened the app.
  if (signedOutNotice != null) {
    return <SignedOutNotice reason={signedOutNotice.reason} />;
  }

  // First launch, no account: explain the three tabs before anything else.
  // Someone already signed in has seen the app and does not need the tour.
  if (intro.seen === false && !signedIn) {
    return <IntroTour onDone={intro.dismiss} />;
  }

  return (
    // minimal back button: without it iOS labels "back" with the previous
    // route's name, which for tab pushes is the literal group name "(tabs)".
    <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
      {/* GUEST MODE: the tabs are the app's front door for everyone. A visitor
          with no account browses the map, reads a business room and sees
          one traveler; the account is asked for at the moment of action, not
          at the door (docs/DESIGN.md). A half-finished ACCOUNT is the one
          exception — it finishes onboarding first. A guest is not one of
          those: they declined the account, so there is nothing to finish. */}
      <Stack.Protected guard={!needsProfile}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={needsProfile}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      {/* Reachable from every sign-up gate, signed in or not. */}
      <Stack.Screen name="(auth)" />
      {/* The password-reset link's landing route. It has to be in the tree for
          `samewhere://reset-password` to resolve inside this layout at all —
          see app/reset-password. The recovery branch above takes over before
          it renders whenever the link still carries tokens. */}
      <Stack.Screen name="reset-password" />
      {/* A place's page is readable signed-out for the same reason a business
          room is: the map is the front door, and a visitor who taps a marker
          must land somewhere real rather than on a sign-up wall. Every ACTION
          on it still asks for an account at the moment it is taken. */}
      <Stack.Screen
        name="place/[id]"
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
      />
      {/* Business rooms are readable signed-out (the public preview), so this
          sits outside the guards like guidelines does. */}
      <Stack.Screen
        name="room/[id]"
        // The screen draws its own one-storey header (features/chat/thread-header).
        // Switched off HERE rather than from inside the screen: a <Stack.Screen>
        // inside the component applies through setOptions AFTER mount, so the
        // native stack pushes the route with an empty nav bar and removes it a
        // frame later - the content jumps by a header's height on every thread
        // open, which is the two-storey chrome this was meant to delete,
        // flashing once per push.
        options={{ headerShown: false }}
      />
      {/* Profile opens from the avatar in the Map/Travelers headers, and it
          is deliberately OUTSIDE the signed-in guard: a guest who taps the
          avatar must land on a real screen (which then invites them to join)
          rather than have the tap silently do nothing. */}
      <Stack.Screen
        name="profile-me"
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
      />
      {/* Screens any REGISTERED account needs, traveler or place.
          `onboarded` is permanently false for a business account by design
          (routing.ts: they never do traveler onboarding), so anything a
          business also has to reach cannot sit behind that half of the
          guard. Chat was the one that mattered: a traveler messages a bar,
          my_chats puts the thread in the bar's Chat tab, the bar taps it,
          and the route was not in the tree — so the whole inbound-message
          feature was dead on the receiving end, silently. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen
          name="chat/[id]"
          // The screen draws its own one-storey header (features/chat/thread-header).
          // Switched off HERE rather than from inside the screen: a <Stack.Screen>
          // inside the component applies through setOptions AFTER mount, so the
          // native stack pushes the route with an empty nav bar and removes it a
          // frame later - the content jumps by a header's height on every thread
          // open, which is the two-storey chrome this was meant to delete,
          // flashing once per push.
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="archived-chats"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
        {/* Where the waiting first messages go once there are too many of
            them to keep in the inbox. signedIn, not signedIn && onboarded:
            the same guard the rest of the chat surfaces sit behind, so a
            route the Chat tab can offer is always a route the navigator
            has. */}
        <Stack.Screen
          name="first-messages"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
        {/* signedIn, deliberately NOT `signedIn && onboarded`. A business
            account never satisfies `onboarded` by design (routing.ts), and
            that is exactly how three other routes ended up doing nothing for
            them - while an owner is as likely as a traveler to need to change
            the password on the account their listing hangs off. */}
        <Stack.Screen name="account-credentials" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
        {/* Everything a traveler DOES with a place needs an account, which is
            why these are inside the guard while the page itself is not. */}
        <Stack.Screen name="join-place" options={{ presentation: 'modal' }} />
        <Stack.Screen name="message-place" options={{ presentation: 'modal' }} />
        <Stack.Screen name="rate-place" options={{ presentation: 'modal' }} />
        {/* Reporting a place stays behind the traveler guard. A business
            account must not be able to report a rival — one report emails
            support and queues a Claude impersonation scan, which is one
            verdict away from darkening a competitor — and report_business
            now refuses a business caller outright, so this guard and the
            database agree instead of one of them carrying it alone. */}
        <Stack.Screen name="report-place" options={{ presentation: 'modal' }} />
        <Stack.Screen name="verification" options={{ presentation: 'modal' }} />
        <Stack.Screen name="visibility" options={{ presentation: 'modal' }} />
        {/* The inventory a block never had. Beside visibility because it is
            the same kind of thing: who can see you, and who you have already
            decided cannot. */}
        <Stack.Screen name="blocked" options={{ presentation: 'modal' }} />
        <Stack.Screen name="compose-request" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="profile/[userId]"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
        <Stack.Screen name="new-group" options={{ presentation: 'modal' }} />
        {/* A modal, like every other "do one thing and come back": it is
            opened from a group's page, adds people, and closes onto it. */}
        <Stack.Screen name="add-people/[chatId]" options={{ presentation: 'modal' }} />
        {/* Both directions of the same act: from a group, find a person;
            from a person, pick a group. */}
        <Stack.Screen name="add-to-group/[userId]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="message/[userId]" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="group/[id]"
          // The screen draws its own one-storey header (features/chat/thread-header).
          // Switched off HERE rather than from inside the screen: a <Stack.Screen>
          // inside the component applies through setOptions AFTER mount, so the
          // native stack pushes the route with an empty nav bar and removes it a
          // frame later - the content jumps by a header's height on every thread
          // open, which is the two-storey chrome this was meant to delete,
          // flashing once per push.
          options={{ headerShown: false }}
        />
      </Stack.Protected>
      {/* The three editors signup now sends people into, which is why they
          are not behind `onboarded`: a person part way through signup has not
          been stamped yet, and prompts, priorities and trips are three whole
          sections of a profile that nothing used to ask for. `needsProfile`
          is exactly "signed in, mid-signup, and neither a guest nor a
          business", so this guard admits somebody finishing their profile and
          nobody else. A business must never reach these — refuse_business_write
          would refuse a trip anyway, and this keeps the client and the
          database saying the same thing. */}
      <Stack.Protected guard={signedIn && (onboarded || needsProfile)}>
        <Stack.Screen name="edit-prompt" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-priorities" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-trip" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      {/* The business side. `business-signup` is deliberately OUTSIDE the
          onboarded guard: the whole point is that it is reached by an account
          that has NOT finished a traveler profile, and putting it behind that
          guard would make it unreachable by exactly the people it is for.
          The rest is guarded on being signed in, because register_business
          has already run by then. */}
      <Stack.Protected guard={signedIn}>
        {/* NOT modals, and that is a crash fix rather than a taste call.
            These two are the only screens in the app that can legitimately
            end up as the ONLY route in the root stack: signup is reached by a
            Redirect and the code screen by a replace, and registering the
            business flips `needsProfile` false, which filters `onboarding`
            out of the navigator underneath them. react-native-screens forces
            the first screen of a stack to be a push controller whatever its
            stackPresentation, so a modal that lands at index 0 has to be
            reshuffled out of the presented set while it is on screen — the
            state its own source calls "illegally reshuffle presented
            controllers". Confirming the code then replaced that index-0 slot
            with a group whose layout mounts native tabs in the same commit,
            and the app died with the listing already live on the server. Both
            are full-screen StepShell flows; neither was ever a sheet. */}
        <Stack.Screen name="business-signup" />
        <Stack.Screen name="business-email" />
        <Stack.Screen name="business-storefront" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business-edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="business-post" options={{ presentation: 'modal' }} />
        <Stack.Screen name="saved-replies" />
      </Stack.Protected>
      {/* Outside every guard so both policy screens are readable BEFORE
          sign-up (the welcome screen and the consent line link to them) and
          from the profile tab after — but declared LAST: the first child of
          the stack becomes the anchor route, and an unguarded screen in that
          slot swallows every cold start. */}
      <Stack.Screen name="guidelines" options={{ presentation: 'modal' }} />
      <Stack.Screen name="privacy" options={{ presentation: 'modal' }} />
      {/* Unguarded for the same reason, and one more: somebody who cannot
          sign in is the person most likely to need to write in. */}
      <Stack.Screen name="contact" options={{ presentation: 'modal' }} />
      {/* Reporting needs a session, not a profile. A guest in a group is in
          a chat with strangers like anyone else, and this sat inside the
          member-only block, so the Report action in their message menu
          pushed a route that was not registered and did nothing. Safety
          actions do not get to be the ones that quietly fail. */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="report" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      {/* Typing a name is how somebody with no account BECOMES a guest, so
          it has to mount before there is a session, and again afterwards so
          they can change it. It sat behind `signedIn && onboarded`, which is
          the one pair of states it is never in: "Join with a name" pushed a
          route that was not registered and nothing happened. */}
      <Stack.Screen name="guest-name" options={{ presentation: 'modal' }} />
      {/* An invite link can arrive before a person has an account. The screen
          shows what the group is and offers to make one, rather than bouncing
          them to a welcome page that says nothing about why they tapped. */}
      <Stack.Screen
        name="join-group/[token]"
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
      />
      {/* The https spelling of the same invite, the one iOS hands over for
          link.samewhere.io/i/<token>. Same screen, same options: the root
          defaults to headerShown false, and on a cold start the header is
          where the back chevron lives. */}
      <Stack.Screen
        name="i/[token]"
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
      />
    </Stack>
  );
}

/**
 * React Navigation's own chrome, in Nocturne's values. Its DarkTheme paints
 * #121212 cards on #010101, which is close enough to the app's ground to look
 * like a mistake and far enough to show a seam at every header.
 */
const NavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.dark.canvas,
    card: Colors.dark.canvas,
    text: Colors.dark.text,
    border: Colors.dark.hairline,
    primary: Colors.dark.accent,
    notification: Colors.dark.highlight,
  },
};

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Always dark, and in Nocturne's own values: React Navigation's
          DarkTheme paints near-black chrome (#121212 cards on #010101), which
          left a visible seam wherever a navigation header met the page. */}
      <ThemeProvider value={NavigationTheme}>
        <AnimatedSplashOverlay />
        <RootNavigator />
        {/* A sibling of the navigator, not a child of any screen: the phone
            being offline is a fact about the room somebody walked into, and
            it outlives whatever screen they happen to be on. It renders null
            unless the query client has actually seen requests fail, so on a
            working connection this costs one subscription and nothing else.

            Mounted here because it was mounted NOWHERE: the component, its
            store and its 117 lines of passing tests all shipped in the same
            commit as a feature no person could ever see. Four review lenses
            found it independently. */}
        <ConnectionBanner />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  // The rules, read from behind the gate. Same shape as the /guidelines
  // screen, minus the router it cannot use.
  gateRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  gatePage: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  gateFooter: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
  },
  // Must equal the native splash background, for the same reason the splash
  // overlay does (components/animated-icon.tsx).
  bootHold: {
    flex: 1,
    backgroundColor: SplashField,
  },
  errorRoot: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  errorContent: {
    flex: 1,
    maxWidth: 480,
  },
  // The content container, not the frame: a ScrollView centres its children
  // through flexGrow on this, and pads and spaces them here too.
  errorScroll: {
    flexGrow: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  errorText: {
    textAlign: 'center',
  },
});
