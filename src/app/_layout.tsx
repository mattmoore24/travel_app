import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useAuthStore } from '@/features/auth/store';
import { useAuthListener } from '@/features/auth/use-auth-listener';
import { useOwnProfile } from '@/features/profile/hooks';
import { queryClient } from '@/lib/query-client';
import { isSupabaseConfigured } from '@/lib/supabase';

SplashScreen.preventAutoHideAsync();

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
