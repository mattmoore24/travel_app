import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { IntroTour } from '@/features/intro/intro-tour';
import { useIntroState } from '@/features/intro/store';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Spacing, SplashField } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { ResetPasswordScreen } from '@/features/auth/reset-password-screen';
import { owesOnboarding, rootIsReady } from '@/features/auth/routing';
import { useAuthListener } from '@/features/auth/use-auth-listener';
import { useOwnBusiness } from '@/features/business/hooks';
import { useAccountStanding, useOwnProfile } from '@/features/profile/hooks';
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

// Shown when we're signed in but the profile fetch failed (offline cold
// start, server error) — without it, users would be routed into a blank
// onboarding stack with no way out.
function ProfileLoadError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <ThemedView style={styles.errorRoot}>
      <SafeAreaView style={styles.errorContent}>
        <ThemedText type="subtitle" style={styles.errorText}>
          Can&apos;t load your profile
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.errorText}>
          Check your connection and try again.
        </ThemedText>
        <PrimaryButton label="Retry" loading={retrying} onPress={onRetry} />
        <PrimaryButton
          variant="ghost"
          label="Sign out"
          onPress={() => {
            signOut().catch(() => {});
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

// The DB independently refuses suspended/banned accounts on the abuse
// channels (message requests, request responses, chat sends, verification);
// other writes are merely invisible to others via the visibility helpers.
// This screen tells the user what happened instead of surfacing permission
// errors — it is UX, not the enforcement layer.
function AccountGate({
  status,
  suspendedUntil,
}: {
  status: string;
  suspendedUntil: string | null;
}) {
  const suspended = status === 'suspended';
  const until = suspendedUntil ? new Date(suspendedUntil) : null;
  return (
    <ThemedView style={styles.errorRoot}>
      <SafeAreaView style={styles.errorContent}>
        <ThemedText type="subtitle" style={styles.errorText}>
          {suspended ? 'Account suspended' : 'Account banned'}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.errorText}>
          {suspended
            ? `Your account is suspended${
                until ? ` until ${until.toLocaleDateString()}` : ''
              } for breaking our community guidelines.`
            : 'Your account is closed for repeatedly breaking our community guidelines.'}
        </ThemedText>
        <PrimaryButton
          variant="ghost"
          label="Sign out"
          onPress={() => {
            signOut().catch(() => {});
          }}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function RootNavigator() {
  useAuthListener();
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const recovery = useAuthStore((s) => s.recovery);
  const intro = useIntroState();
  const profileQuery = useOwnProfile();
  const standingQuery = useAccountStanding();
  const businessQuery = useOwnBusiness();

  const signedIn = session != null;
  const onboarded = profileQuery.data?.onboarding_completed_at != null;
  // Not `signedIn && !onboarded`: a guest is signed in and can never be
  // onboarded, so that expression traps them. See features/auth/routing.
  // A business account is the second kind that can never be onboarded, and
  // for the same structural reason a guest cannot. See features/auth/routing.
  const isBusiness = businessQuery.data != null;
  const needsProfile = owesOnboarding(
    session,
    profileQuery.data?.onboarding_completed_at,
    isBusiness
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
      <ProfileLoadError onRetry={() => profileQuery.refetch()} retrying={profileQuery.isFetching} />
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
        options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
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
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
        <Stack.Screen
          name="archived-chats"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-prompt" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-priorities" options={{ presentation: 'modal' }} />
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
        <Stack.Screen name="add-trip" options={{ presentation: 'modal' }} />
        <Stack.Screen name="compose-request" options={{ presentation: 'modal' }} />
        <Stack.Screen name="drop-pin" options={{ presentation: 'modal' }} />
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
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
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
      </Stack.Protected>
      {/* Outside every guard so it's readable BEFORE sign-up (the welcome
          screen links to it) and from the profile tab after — but declared
          LAST: the first child of the stack becomes the anchor route, and an
          unguarded screen in that slot swallows every cold start. */}
      <Stack.Screen name="guidelines" options={{ presentation: 'modal' }} />
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
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
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
    alignItems: 'stretch',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  errorText: {
    textAlign: 'center',
  },
});
