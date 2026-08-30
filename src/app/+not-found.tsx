import { router, Stack, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PrimaryButton } from '@/components/form/primary-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Space, Spacing } from '@/constants/theme';

/**
 * The screen an unrecognised link lands on.
 *
 * Without this file expo-router falls through to its own "Unmatched Route"
 * screen, which is a light-mode developer page in an app that declares
 * `userInterfaceStyle: "dark"` — the exact thing the header comment in
 * src/app/reset-password.tsx records the founder hitting once already, because
 * that route did not exist either.
 *
 * It is placed inside src/app alongside _layout.tsx on purpose: expo-router's
 * default unmatched route is a SIBLING of the `__root` slot, so a file anywhere
 * else does not get mounted by the root layout and the same trap reappears
 * silently. Smoke-test it with a deliberately bogus deep link rather than by
 * reading the tree.
 */
export default function NotFoundScreen() {
  const pathname = usePathname();

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ThemedView style={styles.root}>
        <View style={styles.body}>
          <ThemedText type="title">That link did not open</ThemedText>
          <ThemedText themeColor="textSecondary">
            {pathname && pathname !== '/'
              ? `Nothing here answers to ${pathname}. The link may have expired, or it may have been meant for a newer version of the app.`
              : 'The link may have expired, or it may have been meant for a newer version of the app.'}
          </ThemedText>
          <PrimaryButton label="Go to the map" onPress={() => router.replace('/(tabs)')} />
        </View>
      </ThemedView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    maxWidth: MaxContentWidth,
    justifyContent: 'center',
    gap: Space.lg,
    padding: Spacing.four,
  },
});
