import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { IntroTour } from '@/features/intro/intro-tour';
import { useIntroState } from '@/features/intro/store';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { useAuthListener } from '@/features/auth/use-auth-listener';
import { useAccountStanding, useOwnProfile } from '@/features/profile/hooks';
import { queryClient } from '@/lib/query-client';
import { isSupabaseConfigured } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

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
            ? `Your account broke our community guidelines and is suspended${
                until ? ` until ${until.toLocaleDateString()}` : ''
              }. This app is for platonic travel friendships.`
            : 'Your account has been permanently banned for repeated violations of our community guidelines.'}
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
  const intro = useIntroState();
  const profileQuery = useOwnProfile();
  const standingQuery = useAccountStanding();

  const signedIn = session != null;
  const onboarded = profileQuery.data?.onboarding_completed_at != null;
  // Hold routing until the persisted session is restored and (when signed in)
  // the first profile + standing fetches settle — otherwise users flash
  // through the wrong stack on cold start.
  const ready =
    initialized &&
    (!signedIn ||
      !isSupabaseConfigured ||
      ((profileQuery.isSuccess || profileQuery.isError) &&
        (standingQuery.isSuccess || standingQuery.isError)));

  if (!ready || intro.seen === null) {
    return null;
  }

  if (signedIn && profileQuery.isError) {
    return (
      <ProfileLoadError onRetry={() => profileQuery.refetch()} retrying={profileQuery.isFetching} />
    );
  }

  const standing = standingQuery.data;
  if (signedIn && (standing?.status === 'suspended' || standing?.status === 'banned')) {
    return <AccountGate status={standing.status} suspendedUntil={standing.suspended_until} />;
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
          with no account browses the map, reads an establishment room and sees
          one traveler; the account is asked for at the moment of action, not
          at the door (docs/DESIGN.md). Signed-in-but-unfinished accounts are
          the one exception — they finish onboarding first. */}
      <Stack.Protected guard={!signedIn || onboarded}>
        <Stack.Screen name="(tabs)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      {/* Reachable from every sign-up gate, signed in or not. */}
      <Stack.Screen name="(auth)" />
      {/* Establishment rooms are readable signed-out (the hostel's public
          preview), so this sits outside the guards like guidelines does. */}
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
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
        <Stack.Screen name="verification" options={{ presentation: 'modal' }} />
        <Stack.Screen name="add-trip" options={{ presentation: 'modal' }} />
        <Stack.Screen name="compose-request" options={{ presentation: 'modal' }} />
        <Stack.Screen name="drop-pin" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="chat/[id]"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
        <Stack.Screen
          name="profile/[userId]"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
        <Stack.Screen name="report" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="archived-chats"
          options={{ headerShown: true, headerTitle: '', headerShadowVisible: false }}
        />
      </Stack.Protected>
      {/* Outside every guard so it's readable BEFORE sign-up (the welcome
          screen links to it) and from the profile tab after — but declared
          LAST: the first child of the stack becomes the anchor route, and an
          unguarded screen in that slot swallows every cold start. */}
      <Stack.Screen name="guidelines" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        <RootNavigator />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
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
