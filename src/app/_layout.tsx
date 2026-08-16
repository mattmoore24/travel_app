import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { signOut } from '@/features/auth/api';
import { useAuthStore } from '@/features/auth/store';
import { useAuthListener } from '@/features/auth/use-auth-listener';
import { useOwnProfile } from '@/features/profile/hooks';
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

function RootNavigator() {
  useAuthListener();
  const session = useAuthStore((s) => s.session);
  const initialized = useAuthStore((s) => s.initialized);
  const profileQuery = useOwnProfile();

  const signedIn = session != null;
  const onboarded = profileQuery.data?.onboarding_completed_at != null;
  // Hold routing until the persisted session is restored and (when signed in)
  // the first profile fetch settles — otherwise users flash through the wrong
  // stack on cold start.
  const ready =
    initialized &&
    (!signedIn || !isSupabaseConfigured || profileQuery.isSuccess || profileQuery.isError);

  if (!ready) {
    return null;
  }

  if (signedIn && profileQuery.isError) {
    return (
      <ProfileLoadError onRetry={() => profileQuery.refetch()} retrying={profileQuery.isFetching} />
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !onboarded}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && onboarded}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      </Stack.Protected>
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
